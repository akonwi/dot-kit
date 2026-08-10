import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

const REFRESH_MS = 60_000;
const COMMAND_TIMEOUT_MS = 8_000;
const MIDDLE_DOT = "·";
const LOCATION_ID = "location";
const BUILT_IN_LOCATION_ID = "kit.footer.location";
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RpcId = string | number;
type GitInfo = { branch: string | null; dirty: boolean };
type GitContext = { root: string; branch: string | null; dirty: boolean } | null;
type PullRequestInfo = { number: number; url: string };
type CheckBucket = "pass" | "fail" | "pending" | "skipping" | "cancel";
type CheckSummary = {
	state: CheckBucket | "unknown";
	count: number;
	total: number;
};
type CommandResult = {
	status: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};
type PendingRequest = {
	resolve: (value: Json) => void;
	reject: (error: Error) => void;
};

class Endpoint {
	private nextId = 1;
	private pending = new Map<RpcId, PendingRequest>();
	private writeChain = Promise.resolve();
	private initialized = false;
	private stopping = false;
	private cwd = process.cwd();
	private git: GitInfo = { branch: null, dirty: false };
	private pullRequest: PullRequestInfo | null = null;
	private checks: CheckSummary | null = null;
	private generation = 0;
	private refreshTimer: ReturnType<typeof setInterval> | null = null;
	private children = new Set<ChildProcess>();

	start(): void {
		const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
		input.on("line", (line) => {
			if (!line.trim()) return;
			if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) {
				console.error("Inbound frame exceeds 16 MiB");
				process.exit(1);
			}
			let message: unknown;
			try {
				message = JSON.parse(line);
			} catch (error) {
				console.error("Invalid JSON-RPC frame:", error);
				process.exit(1);
			}
			for (const item of Array.isArray(message) ? message : [message]) {
				void this.receive(item);
			}
		});
	}

	private async receive(message: unknown): Promise<void> {
		if (!isRecord(message) || message.jsonrpc !== "2.0") return;
		if (("result" in message || "error" in message) && isRpcId(message.id)) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (isRecord(message.error)) {
				pending.reject(new Error(String(message.error.message ?? "Kit request failed")));
			} else {
				pending.resolve((message.result ?? null) as Json);
			}
			return;
		}
		if (typeof message.method !== "string") return;
		const params = isRecord(message.params) ? message.params : {};
		if (!isRpcId(message.id)) {
			this.handleNotification(message.method, params);
			return;
		}
		try {
			const result = await this.handleRequest(message.method, params);
			await this.send({ jsonrpc: "2.0", id: message.id, result });
			if (message.method === "shutdown") process.exit(0);
		} catch (error) {
			await this.send({
				jsonrpc: "2.0",
				id: message.id,
				error: {
					code: -32000,
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	private async handleRequest(
		method: string,
		params: Record<string, unknown>,
	): Promise<Json> {
		switch (method) {
			case "initialize": {
				if (params.protocolVersion !== 1) throw new Error("Unsupported protocol version");
				const context = isRecord(params.context) ? params.context : {};
				const project = isRecord(context.project) ? context.project : {};
				if (typeof project.cwd === "string") this.cwd = project.cwd;
				this.git = gitInfoFromContext(project.git);
				this.initialized = true;
				setTimeout(() => void this.initializeContributions(), 0);
				return { protocolVersion: 1 };
			}
			case "kit/footer/click":
				if (params.id === LOCATION_ID && this.pullRequest) {
					await this.request("kit/system/open-url", { url: this.pullRequest.url });
				}
				return null;
			case "shutdown":
				this.stop();
				return null;
			default:
				throw new Error(`Method not found: ${method}`);
		}
	}

	private handleNotification(method: string, params: Record<string, unknown>): void {
		if (this.stopping) return;
		switch (method) {
			case "kit/events/project.changed":
				if (typeof params.cwd === "string") this.cwd = params.cwd;
				this.git = gitInfoFromContext(params.git);
				this.pullRequest = null;
				this.checks = null;
				void this.refresh(this.git);
				break;
			case "kit/events/git.changed":
				this.git = gitInfoFromContext(params.git);
				void this.refresh(this.git);
				break;
		}
	}

	private async initializeContributions(): Promise<void> {
		try {
			await this.request("kit/footer/hide", { id: BUILT_IN_LOCATION_ID });
			await this.refresh(this.git);
			this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
		} catch (error) {
			console.error("Could not initialize Git footer:", error);
		}
	}

	private async refresh(nextGit?: GitInfo): Promise<void> {
		const currentGeneration = ++this.generation;
		this.git = nextGit ?? (await this.getGitInfo());
		if (this.stopping || currentGeneration !== this.generation) return;

		if (!isNamedBranch(this.git.branch)) {
			this.pullRequest = null;
			this.checks = null;
			await this.render();
			return;
		}

		await this.render();
		const pullRequest = await this.getPullRequestInfo();
		if (this.stopping || currentGeneration !== this.generation) return;
		this.pullRequest = pullRequest;
		this.checks = pullRequest ? await this.getCheckSummary() : null;
		if (this.stopping || currentGeneration !== this.generation) return;
		await this.render();
	}

	private async render(): Promise<void> {
		if (this.stopping) return;
		await this.request("kit/footer/set", {
			id: LOCATION_ID,
			content: formatLocation(this.cwd, this.git, this.pullRequest, this.checks),
			side: "right",
			clickable: this.pullRequest !== null,
		});
	}

	private async getGitInfo(): Promise<GitInfo> {
		const result = await this.runCommand("git", ["status", "--porcelain=2", "--branch"]);
		if (result.status !== 0) return { branch: null, dirty: false };
		return parseGitStatus(result.stdout);
	}

	private async getPullRequestInfo(): Promise<PullRequestInfo | null> {
		const result = await this.runCommand("gh", ["pr", "view", "--json", "number,url"]);
		if (result.status !== 0 || !result.stdout.trim()) return null;
		try {
			const data = JSON.parse(result.stdout);
			return typeof data.number === "number" && typeof data.url === "string"
				? { number: data.number, url: data.url }
				: null;
		} catch {
			return null;
		}
	}

	private async getCheckSummary(): Promise<CheckSummary | null> {
		const result = await this.runCommand("gh", ["pr", "checks", "--json", "bucket"]);
		if (!result.stdout.trim()) return null;
		try {
			const checks = JSON.parse(result.stdout) as Array<{ bucket?: string }>;
			if (!Array.isArray(checks)) return null;
			if (checks.length === 0) return { state: "unknown", count: 0, total: 0 };
			const counts = new Map<CheckBucket, number>();
			for (const check of checks) {
				if (isCheckBucket(check.bucket)) {
					counts.set(check.bucket, (counts.get(check.bucket) ?? 0) + 1);
				}
			}
			for (const state of ["fail", "pending", "cancel", "pass", "skipping"] as const) {
				const count = counts.get(state) ?? 0;
				if (count > 0) return { state, count, total: checks.length };
			}
			return { state: "unknown", count: 0, total: checks.length };
		} catch {
			return null;
		}
	}

	private runCommand(command: string, args: string[]): Promise<CommandResult> {
		return new Promise((resolve) => {
			const child = spawn(command, args, {
				cwd: this.cwd,
				env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
				stdio: ["ignore", "pipe", "pipe"],
			});
			this.children.add(child);
			let stdout = "";
			let stderr = "";
			let settled = false;
			let timedOut = false;
			const finish = (status: number | null) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.children.delete(child);
				resolve({ status, stdout, stderr, timedOut });
			};
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill("SIGTERM");
				finish(null);
			}, COMMAND_TIMEOUT_MS);
			child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
			child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
			child.on("error", () => finish(null));
			child.on("close", finish);
		});
	}

	private request(method: string, params?: Json): Promise<Json> {
		if (!this.initialized || this.stopping) return Promise.reject(new Error("Plugin is not ready"));
		const id = `plugin-${this.nextId++}`;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			void this.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
		});
	}

	private send(message: unknown): Promise<void> {
		const line = `${JSON.stringify(message)}\n`;
		if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) {
			return Promise.reject(new Error("Outbound frame exceeds 16 MiB"));
		}
		const write = () => new Promise<void>((resolve, reject) => {
			process.stdout.write(line, (error) => error ? reject(error) : resolve());
		});
		const pending = this.writeChain.then(write);
		this.writeChain = pending.catch((error) => console.error("Protocol write failed:", error));
		return pending;
	}

	private stop(): void {
		this.stopping = true;
		this.generation += 1;
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		this.refreshTimer = null;
		for (const child of this.children) child.kill("SIGTERM");
		this.children.clear();
		for (const pending of this.pending.values()) pending.reject(new Error("Plugin stopped"));
		this.pending.clear();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRpcId(value: unknown): value is RpcId {
	return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

function gitInfoFromContext(value: unknown): GitInfo {
	if (!isRecord(value)) return { branch: null, dirty: false };
	return {
		branch: typeof value.branch === "string" ? value.branch : null,
		dirty: value.dirty === true,
	};
}

function parseGitStatus(output: string): GitInfo {
	let branch: string | null = null;
	let detachedOid: string | null = null;
	let dirty = false;
	for (const line of output.split(/\r?\n/)) {
		if (!line) continue;
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			branch = head === "(detached)" ? "detached" : head;
		} else if (line.startsWith("# branch.oid ")) {
			detachedOid = line.slice("# branch.oid ".length).trim();
		} else if (!line.startsWith("#")) {
			dirty = true;
		}
	}
	if (branch === "detached" && detachedOid && detachedOid !== "(initial)") {
		branch = `detached@${detachedOid.slice(0, 7)}`;
	}
	return { branch, dirty };
}

function isNamedBranch(branch: string | null): branch is string {
	return Boolean(branch && branch !== "detached" && !branch.startsWith("detached@"));
}

function isCheckBucket(value: unknown): value is CheckBucket {
	return value === "pass" || value === "fail" || value === "pending" || value === "skipping" || value === "cancel";
}

function formatCheckSummary(summary: CheckSummary | null): string {
	if (!summary) return "CI unknown";
	if (summary.total === 0) return "CI none";
	switch (summary.state) {
		case "pass": return `CI pass ${summary.count}/${summary.total}`;
		case "fail": return `CI fail ${summary.count}/${summary.total}`;
		case "pending": return `CI pending ${summary.count}/${summary.total}`;
		case "cancel": return `CI canceled ${summary.count}/${summary.total}`;
		case "skipping": return `CI skipped ${summary.count}/${summary.total}`;
		case "unknown": return "CI unknown";
	}
}

function checkToken(summary: CheckSummary | null): string {
	switch (summary?.state) {
		case "pass": return "toolText";
		case "fail":
		case "cancel": return "errorText";
		case "pending": return "warningText";
		default: return "textMuted";
	}
}

function formatLocation(
	cwd: string,
	git: GitInfo,
	pullRequest: PullRequestInfo | null,
	checks: CheckSummary | null,
): Json[] {
	if (!git.branch) return [{ text: cwd }];
	const content: Json[] = [{ text: `${cwd} (${git.branch}${git.dirty ? "*" : ""}` }];
	if (pullRequest) {
		content.push(
			{ text: ` ${MIDDLE_DOT} PR #${pullRequest.number} ${MIDDLE_DOT} ` },
			{ text: formatCheckSummary(checks), style: { fg: checkToken(checks) } },
		);
	}
	content.push({ text: ")" });
	return content;
}

new Endpoint().start();
