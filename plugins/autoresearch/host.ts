import { createInterface } from "node:readline";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RpcId = string | number;
type Handler = (params: any, signal: AbortSignal) => any | Promise<any>;

const OPTIONAL = Symbol("optional");
type Schema = Record<string | symbol, any>;

export const Type = {
	String: (options: Record<string, unknown> = {}) => ({ type: "string", ...options }),
	Number: (options: Record<string, unknown> = {}) => ({ type: "number", ...options }),
	Boolean: (options: Record<string, unknown> = {}) => ({ type: "boolean", ...options }),
	Unknown: () => ({}),
	Literal: (value: Json) => ({ const: value }),
	Union: (schemas: Schema[], options: Record<string, unknown> = {}) => ({ anyOf: schemas, ...options }),
	Optional: (schema: Schema) => ({ ...schema, [OPTIONAL]: true }),
	Record: (_key: Schema, _value: Schema, options: Record<string, unknown> = {}) => ({
		type: "object",
		additionalProperties: true,
		...options,
	}),
	Object: (properties: Record<string, Schema>) => {
		const cleanProperties: Record<string, Schema> = {};
		const required: string[] = [];
		for (const [name, schema] of Object.entries(properties)) {
			const { [OPTIONAL]: optional, ...clean } = schema;
			cleanProperties[name] = clean;
			if (!optional) required.push(name);
		}
		return {
			type: "object",
			properties: cleanProperties,
			required,
			additionalProperties: false,
		};
	},
};

export type Disposer = () => void;
export type ToolResult<T = unknown> = {
	content: Array<{ type: "text"; text: string }>;
	details?: T;
	terminate?: boolean;
};
export type PluginAPI = any;

class RpcPeer {
	private nextId = 1;
	private pending = new Map<RpcId, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	private active = new Map<RpcId, AbortController>();
	private handlers = new Map<string, Handler>();
	private initialized = false;
	private writeChain = Promise.resolve();

	on(method: string, handler: Handler): void {
		this.handlers.set(method, handler);
	}

	setInitialized(): void {
		this.initialized = true;
	}

	request(method: string, params?: Json): Promise<any> {
		if (!this.initialized) throw new Error(`Cannot request ${method} before initialization`);
		const id = `plugin-${this.nextId++}`;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
		});
	}

	notify(method: string, params?: Json): void {
		if (!this.initialized) return;
		this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
	}

	start(): void {
		const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
		input.on("line", (line) => {
			if (!line.trim()) return;
			try {
				const message = JSON.parse(line);
				void this.receive(message);
			} catch (error) {
				console.error("Invalid JSON-RPC frame:", error);
				process.exitCode = 1;
			}
		});
	}

	private async receive(message: any): Promise<void> {
		if (message && message.jsonrpc === "2.0" && ("result" in message || "error" in message) && "id" in message) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (message.error) pending.reject(new Error(message.error.message ?? "JSON-RPC request failed"));
			else pending.resolve(message.result);
			return;
		}
		if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
		if (message.method === "kit/cancel") {
			this.active.get(message.params?.id)?.abort();
			return;
		}
		const handler = this.handlers.get(message.method);
		if (!("id" in message)) {
			if (handler) await handler(message.params, new AbortController().signal);
			return;
		}
		if (!handler) {
			this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
			return;
		}
		const abort = new AbortController();
		this.active.set(message.id, abort);
		try {
			const result = await handler(message.params, abort.signal);
			if (abort.signal.aborted) {
				this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32001, message: "Request cancelled" } });
			} else {
				this.send({ jsonrpc: "2.0", id: message.id, result: result ?? null });
			}
		} catch (error) {
			this.send({
				jsonrpc: "2.0",
				id: message.id,
				error: { code: abort.signal.aborted ? -32001 : -32000, message: error instanceof Error ? error.message : String(error) },
			});
		} finally {
			this.active.delete(message.id);
		}
	}

	private send(message: unknown): void {
		const line = `${JSON.stringify(message)}\n`;
		this.writeChain = this.writeChain.then(
			() => new Promise<void>((resolve, reject) => process.stdout.write(line, (error) => error ? reject(error) : resolve())),
		);
	}
}

export function runPlugin(initializePlugin: (kit: PluginAPI) => void | Disposer): void {
	const rpc = new RpcPeer();
	let context = {
		project: { cwd: process.cwd(), git: null as any },
		session: { id: "", name: null as string | null },
	};
	let dispose: void | Disposer;
	let bootstrapped = false;
	const eventHandlers = new Map<string, Array<(...args: any[]) => void>>();
	const commandHandlers = new Map<string, (ctx: any) => any>();
	const toolHandlers = new Map<string, (...args: any[]) => any>();

	const segments = (content: any): any[] => {
		const values = Array.isArray(content) ? content.flat(Infinity) : [content];
		return values.map((value) => typeof value === "string" ? { text: value } : value);
	};
	const eventContext = () => ({ session: kit.session, system: kit.system, ui: kit.ui });
	const emit = (name: string, event: any) => {
		for (const handler of eventHandlers.get(name) ?? []) handler(event, eventContext());
	};
	const requestQuietly = (method: string, params?: Json) => {
		void rpc.request(method, params).catch((error) => console.error(`${method} failed:`, error));
	};

	const kit: any = {
		system: {
			get cwd() { return context.project.cwd; },
			open: (url: string | URL) => rpc.request("kit/system/open-url", { url: String(url) }),
		},
		session: {
			get: () => ({ ...context.session, cwd: context.project.cwd }),
			submitMessage: (text: string) => rpc.request("kit/session/submit-message", { sessionId: context.session.id, text }),
		},
		ui: {
			theme: () => ({ tokens: new Proxy({}, { get: (_target, property) => property }) }),
			text: (text: string, style?: Record<string, unknown>) => ({ text, ...(style ? { style: { fg: style.fg, bg: style.bg, bold: style.bold, dim: style.dim, italic: style.italic, underline: style.underline, strikethrough: style.strikethrough } } : {}) }),
			toast: (toast: any) => rpc.notify("kit/ui/toast", { ...toast, subtitle: toast.subtitle ?? null, persistent: toast.persistent ?? false }),
		},
		footer: {
			set: (id: string, content: any, options: any = {}) => requestQuietly("kit/footer/set", { id, content: segments(content), side: options.side ?? "right", clickable: Boolean(options.onClick) }),
			clear: (id: string) => requestQuietly("kit/footer/clear", { id }),
		},
		addSystemPrompt: (text: string) => requestQuietly("kit/system-prompt/set", { text }),
		registerCommand: (id: string, options: any, handler: any) => {
			commandHandlers.set(id, handler);
			requestQuietly("kit/commands/register", { id, description: options.description, argName: options.argName ?? null, category: options.category ?? null });
			return () => requestQuietly("kit/commands/unregister", { id });
		},
		registerTool: (definition: any) => {
			toolHandlers.set(definition.name, definition.execute);
			requestQuietly("kit/tools/register", {
				id: definition.name,
				label: definition.label,
				description: definition.description,
				inputSchema: definition.parameters,
				executionMode: definition.executionMode ?? "sequential",
				promptSnippet: definition.promptSnippet ?? null,
				promptGuidelines: definition.promptGuidelines ?? [],
			});
			return () => requestQuietly("kit/tools/unregister", { id: definition.name });
		},
		on: (name: string, handler: (...args: any[]) => void) => {
			const handlers = eventHandlers.get(name) ?? [];
			handlers.push(handler);
			eventHandlers.set(name, handlers);
			return () => eventHandlers.set(name, handlers.filter((candidate) => candidate !== handler));
		},
	};

	rpc.on("initialize", async (params) => {
		context = params.context;
		rpc.setInitialized();
		setTimeout(() => {
			if (bootstrapped) return;
			bootstrapped = true;
			dispose = initializePlugin(kit);
		}, 0);
		return { protocolVersion: 1 };
	});
	rpc.on("shutdown", async () => {
		dispose?.();
		setTimeout(() => process.exit(0), 0);
		return null;
	});
	rpc.on("kit/commands/execute", async (params) => {
		const handler = commandHandlers.get(params.id);
		if (!handler) throw new Error(`Unknown command: ${params.id}`);
		return (await handler({ ...eventContext(), args: params.args })) ?? null;
	});
	rpc.on("kit/tools/execute", async (params, signal) => {
		const handler = toolHandlers.get(params.id);
		if (!handler) throw new Error(`Unknown tool: ${params.id}`);
		const result = await handler(params.toolCallId, params.input, signal, undefined);
		return { content: result.content, details: result.details ?? null, terminate: result.terminate ?? false };
	});
	rpc.on("kit/events/project.changed", async (params) => {
		context.project = params;
		emit("session.active.changed", params);
	});
	rpc.on("kit/events/git.changed", async (params) => { context.project.git = params.git; });
	rpc.on("kit/events/session.changed", async (params) => {
		context.session = params;
		emit("session.active.changed", params);
	});
	rpc.on("kit/events/agent.turn.completed", async (params) => emit("agent.turn.completed", params));

	rpc.start();
}
