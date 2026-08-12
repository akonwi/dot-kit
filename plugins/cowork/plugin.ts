// Cowork action-items tool. Lets any interactive Kit session create,
// edit, complete, or reopen items in cowork's aggregate to-do list
// (~/.cowork/actions.json) — the same file cowork's Today tab and
// extraction pipeline read/write (see ~/Developer/cowork,
// docs/adrs/0005 there for the file format).
//
// This is deliberately a plain file-reading/writing plugin, not an MCP
// server or anything routed through cowork's own Kit RPC session: as of
// this writing, Kit's headless RPC mode does not load user/project
// plugins at all (confirmed by reading Kit's source directly — see
// cowork's docs/adrs/0010), so a tool contributed here is only available
// to *interactive* Kit sessions. That's the actual point: any project's
// interactive session can reach cowork's list this way, not just
// cowork's own Agent tab.
//
// No coordination with cowork's session lock (ffi::AcquireSessionLock)
// — this plugin never touches the Kit session, only the actions.json
// file. It's a third writer to that file alongside cowork's TUI and
// extraction pipeline, with the same accepted, documented risk as those
// two already have with each other (atomic rename, no cross-process
// file lock — see cowork's docs/backlog.md).

import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const ACTIONS_PATH = path.join(homedir(), ".cowork", "actions.json");

type ActionItem = {
	id: string;
	text: string;
	group: string;
	parent_id: string;
	source_meeting: string;
	created_at: string;
	completed_at: string;
	due_at: string;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RpcId = string | number;
type PendingRequest = { resolve: (value: Json) => void; reject: (error: Error) => void };

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRpcId(value: unknown): value is RpcId {
	return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

// ── Storage: mirrors cowork's models/actions.ard exactly ─────────────────

function loadItems(): ActionItem[] {
	if (!existsSync(ACTIONS_PATH)) return [];
	try {
		const parsed = JSON.parse(readFileSync(ACTIONS_PATH, "utf8"));
		return Array.isArray(parsed?.items) ? parsed.items : [];
	} catch {
		return [];
	}
}

function saveItems(items: ActionItem[]): void {
	mkdirSync(path.dirname(ACTIONS_PATH), { recursive: true });
	const tmpPath = `${ACTIONS_PATH}.tmp`;
	writeFileSync(tmpPath, JSON.stringify({ items }));
	renameSync(tmpPath, ACTIONS_PATH);
}

// Matches Go's "2006-01-02T15:04:05Z07:00" layout exactly (no fractional
// seconds) — cowork's Ard side parses created_at with that exact layout
// when computing a default due date, and would fail to parse a value
// with milliseconds in it.
function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function generateId(): string {
	return `kit:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ── Overdue logic: mirrors models/actions.ard's effective_due_at /
//    is_overdue exactly, so "list" agrees with cowork's own nudge check.

function dateOnly(iso: string): string {
	return iso.slice(0, 10);
}

function defaultDueAt(createdAt: string, group: string): string {
	const days = group === "immediate" ? 1 : 7;
	const created = new Date(createdAt);
	created.setUTCDate(created.getUTCDate() + days);
	return dateOnly(created.toISOString());
}

function effectiveDueAt(item: ActionItem): string {
	return item.due_at ? dateOnly(item.due_at) : defaultDueAt(item.created_at, item.group);
}

function isOverdue(item: ActionItem, now: string): boolean {
	return dateOnly(now) > effectiveDueAt(item);
}

// ── Tool implementation ───────────────────────────────────────────────────

type ToolInput = {
	action?: "list" | "add" | "edit" | "complete" | "reopen";
	id?: string;
	text?: string;
	group?: "immediate" | "this_week";
	due_at?: string;
	parent_id?: string;
};

function textResult(text: string, details: unknown = null) {
	return { content: [{ type: "text", text }], details };
}

function summarizeItem(item: ActionItem, now: string): string {
	const status = item.completed_at ? "done" : isOverdue(item, now) ? "OVERDUE" : "open";
	const due = item.completed_at ? "" : ` (due ${effectiveDueAt(item)})`;
	return `[${item.id}] (${status}) ${item.text}${due}`;
}

function executeTool(input: ToolInput) {
	const items = loadItems();
	const now = nowIso();

	switch (input.action) {
		case "list": {
			const open = items.filter((item) => !item.completed_at);
			if (open.length === 0) return textResult("No open action items.", { items: [] });
			return textResult(open.map((item) => summarizeItem(item, now)).join("\n"), { items: open });
		}

		case "add": {
			if (!input.text) return textResult("Error: text is required to add an item.");
			const item: ActionItem = {
				id: generateId(),
				text: input.text,
				group: input.group ?? "this_week",
				parent_id: input.parent_id ?? "",
				source_meeting: "",
				created_at: now,
				completed_at: "",
				due_at: input.due_at ?? "",
			};
			items.push(item);
			saveItems(items);
			return textResult(`Added: ${summarizeItem(item, now)}`, { item });
		}

		case "edit": {
			if (!input.id) return textResult("Error: id is required to edit an item.");
			const item = items.find((candidate) => candidate.id === input.id);
			if (!item) return textResult(`Error: no item found with id '${input.id}'.`);
			if (item.completed_at) return textResult(`Error: '${input.id}' is already completed and can't be edited. Reopen it first.`);
			if (input.text !== undefined) item.text = input.text;
			if (input.group !== undefined) item.group = input.group;
			if (input.due_at !== undefined) item.due_at = input.due_at;
			if (input.parent_id !== undefined) item.parent_id = input.parent_id;
			saveItems(items);
			return textResult(`Updated: ${summarizeItem(item, now)}`, { item });
		}

		case "complete": {
			if (!input.id) return textResult("Error: id is required to complete an item.");
			const item = items.find((candidate) => candidate.id === input.id);
			if (!item) return textResult(`Error: no item found with id '${input.id}'.`);
			item.completed_at = now;
			saveItems(items);
			return textResult(`Completed: [${item.id}] ${item.text}`, { item });
		}

		case "reopen": {
			if (!input.id) return textResult("Error: id is required to reopen an item.");
			const item = items.find((candidate) => candidate.id === input.id);
			if (!item) return textResult(`Error: no item found with id '${input.id}'.`);
			item.completed_at = "";
			saveItems(items);
			return textResult(`Reopened: ${summarizeItem(item, now)}`, { item });
		}

		default:
			return textResult(`Unknown action: ${String(input.action)}`);
	}
}

// ── JSON-RPC 2.0 endpoint (self-contained, no shared dependency —
//    matches this repo's plugins/git/plugin.ts convention) ───────────────

class Endpoint {
	private nextId = 1;
	private pending = new Map<RpcId, PendingRequest>();
	private writeChain = Promise.resolve();
	private initialized = false;
	private stopping = false;

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
		if (!isRpcId(message.id)) return; // no notifications handled by this plugin
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

	private async handleRequest(method: string, params: Record<string, unknown>): Promise<Json> {
		switch (method) {
			case "initialize": {
				if (params.protocolVersion !== 1) throw new Error("Unsupported protocol version");
				this.initialized = true;
				setTimeout(() => void this.registerTool(), 0);
				return { protocolVersion: 1 };
			}
			case "kit/tools/execute": {
				if (params.id !== "actions") throw new Error(`Unknown tool: ${String(params.id)}`);
				return executeTool((params.input ?? {}) as ToolInput) as Json;
			}
			case "shutdown":
				this.stopping = true;
				return null;
			default:
				throw new Error(`Method not found: ${method}`);
		}
	}

	private async registerTool(): Promise<void> {
		try {
			await this.request("kit/tools/register", {
				id: "actions",
				label: "Cowork Actions",
				description: "Create, edit, complete, or reopen items in cowork's aggregate action-item list.",
				inputSchema: {
					type: "object",
					properties: {
						action: { type: "string", enum: ["list", "add", "edit", "complete", "reopen"] },
						id: { type: "string", description: "Item id — required for edit, complete, and reopen. Get it from 'list' first." },
						text: { type: "string", description: "The action item's text. Required for add; optional for edit." },
						group: { type: "string", enum: ["immediate", "this_week"], description: "immediate = blocking or due very soon; this_week = everything else open-ended. Defaults to this_week on add." },
						due_at: { type: "string", description: "Explicit deadline as YYYY-MM-DD. Leave unset unless the user actually stated one — cowork falls back to a sensible default based on group." },
						parent_id: { type: "string", description: "Id of a parent item, to add/edit this as a nested sub-task. Leave unset for a top-level item." },
					},
					required: ["action"],
					additionalProperties: false,
				},
				executionMode: "sequential",
				promptSnippet: "Manage cowork's aggregate action-item list",
				promptGuidelines: [
					`Items live in ${ACTIONS_PATH}, shared across every project — this is the user's one aggregate to-do list, not scoped to the current project.`,
					"Call 'list' first when you need an item's id (for edit/complete/reopen) or want to check what's already open before adding something that might be a duplicate.",
					"An item only disappears from 'list' once it's completed — nothing expires or gets cleaned up on its own.",
					"Only set due_at when the user actually stated a deadline. Otherwise leave it unset — cowork computes a sensible default (immediate items: ~1 day, everything else: ~1 week) and a separate scheduled check nudges the user about anything overdue.",
				],
			});
		} catch (error) {
			console.error("Could not register cowork actions tool:", error);
		}
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
		const write = () =>
			new Promise<void>((resolve, reject) => {
				process.stdout.write(line, (error) => (error ? reject(error) : resolve()));
			});
		const pending = this.writeChain.then(write);
		this.writeChain = pending.catch((error) => console.error("Protocol write failed:", error));
		return pending;
	}
}

new Endpoint().start();
