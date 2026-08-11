#!/usr/bin/env bun
/** Google Drive plugin for Kit's JSON-RPC plugin protocol. */

import { KitPluginEndpoint } from "../_shared/rpc";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { docs_v1 } from "googleapis";
import { execSync } from "node:child_process";

// ── Auth ──────────────────────────────────────────────────────────────

const KEYCHAIN_CLIENT_ID = "pi-gdrive";
const KEYCHAIN_CLIENT_SECRET = "pi-gdrive-client-secret";
const KEYCHAIN_REFRESH_TOKEN = "pi-gdrive-refresh-token";
const OAUTH_REDIRECT_PORT = 48127;
const OAUTH_SCOPES = [
	"https://www.googleapis.com/auth/drive",
	"https://www.googleapis.com/auth/documents",
];

function keychainGet(service: string): string {
	return execSync(`security find-generic-password -s "${service}" -w`, {
		encoding: "utf-8",
	}).trim();
}

function keychainSet(service: string, value: string): void {
	execSync(
		`security add-generic-password -a "pi-gdrive" -s "${service}" -D "pi-gdrive-credential" -w "${value}" -U`,
		{ encoding: "utf-8" },
	);
}

function hasKeychainCreds(): boolean {
	try {
		keychainGet(KEYCHAIN_CLIENT_ID);
		keychainGet(KEYCHAIN_CLIENT_SECRET);
		keychainGet(KEYCHAIN_REFRESH_TOKEN);
		return true;
	} catch {
		return false;
	}
}

let _auth: OAuth2Client | null = null;

function getAuth(): OAuth2Client {
	if (_auth) return _auth;
	if (!hasKeychainCreds()) {
		throw new Error(
			"Google Drive credentials not found. Run /gdrive-auth to set up authentication.",
		);
	}
	const clientId = keychainGet(KEYCHAIN_CLIENT_ID);
	const clientSecret = keychainGet(KEYCHAIN_CLIENT_SECRET);
	const refreshToken = keychainGet(KEYCHAIN_REFRESH_TOKEN);
	_auth = new google.auth.OAuth2(clientId, clientSecret);
	_auth.setCredentials({ refresh_token: refreshToken });
	return _auth;
}

// ── OAuth Setup ───────────────────────────────────────────────────────

async function runOAuthFlow(
	clientId: string,
	clientSecret: string,
): Promise<string> {
	const http = await import("node:http");
	const { URL } = await import("node:url");

	const oauth2Client = new google.auth.OAuth2(
		clientId,
		clientSecret,
		`http://localhost:${OAUTH_REDIRECT_PORT}/oauth2callback`,
	);

	const authUrl = oauth2Client.generateAuthUrl({
		access_type: "offline",
		scope: OAUTH_SCOPES,
		prompt: "consent",
	});

	execSync(`open "${authUrl}"`);

	const code = await new Promise<string>((resolve, reject) => {
		const server = http.createServer((req, res) => {
			if (req.url?.includes("/oauth2callback")) {
				const qs = new URL(
					req.url,
					`http://localhost:${OAUTH_REDIRECT_PORT}`,
				).searchParams;
				const authCode = qs.get("code");

				if (authCode) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(
						"<html><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='text-align:center'><h1>✅ Authorized</h1><p>You can close this tab.</p></div></body></html>",
					);
					server.close();
					resolve(authCode);
				} else {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end("<html><body><h1>❌ Failed</h1></body></html>");
					server.close();
					reject(new Error("No authorization code received"));
				}
			}
		});

		server.listen(OAUTH_REDIRECT_PORT);
		setTimeout(() => {
			server.close();
			reject(new Error("OAuth timed out"));
		}, 120_000);
	});

	const { tokens } = await oauth2Client.getToken(code);
	if (!tokens.refresh_token) {
		throw new Error(
			"No refresh token received. Try revoking access at https://myaccount.google.com/permissions and running /gdrive-auth again.",
		);
	}

	return tokens.refresh_token;
}

// ── Helpers ───────────────────────────────────────────────────────────

function extractDocId(input: string): string {
	const urlMatch = input.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
	if (urlMatch?.[1]) return urlMatch[1];
	const sheetMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
	if (sheetMatch?.[1]) return sheetMatch[1];
	if (/^[a-zA-Z0-9-_]+$/.test(input)) return input;
	throw new Error(`Invalid document ID or URL: ${input}`);
}

function detectDocType(input: string): "document" | "spreadsheet" {
	if (input.includes("/spreadsheets/")) return "spreadsheet";
	return "document";
}

// ── Markdown conversion ──────────────────────────────────────────────

function docToMarkdown(doc: docs_v1.Schema$Document): string {
	const lines: string[] = [];
	const body = doc.body?.content ?? [];

	for (const el of body) {
		if (el.paragraph) {
			const para = el.paragraph;
			const style = para.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT";
			let text = "";
			for (const elem of para.elements ?? []) {
				text += elem.textRun?.content ?? "";
			}
			text = text.replace(/\n$/, "");
			if (!text && !para.bullet) continue;

			if (style.startsWith("HEADING_")) {
				const level = Number.parseInt(style.replace("HEADING_", ""), 10);
				lines.push(`${"#".repeat(level)} ${text}`);
			} else if (para.bullet) {
				const indent = "  ".repeat(para.bullet.nestingLevel ?? 0);
				lines.push(`${indent}- ${text}`);
			} else {
				lines.push(text);
			}
			lines.push("");
		} else if (el.table) {
			for (const row of el.table.tableRows ?? []) {
				const cells = (row.tableCells ?? []).map((cell) => {
					return (cell.content ?? [])
						.map((c) =>
							(c.paragraph?.elements ?? [])
								.map((e) => e.textRun?.content ?? "")
								.join("")
								.trim(),
						)
						.join(" ");
				});
				lines.push(`| ${cells.join(" | ")} |`);
			}
			lines.push("");
		}
	}
	return lines.join("\n");
}

// ── Content builder ─────────────────────────────────────────────────

function buildContentRequests(
	content: Array<Record<string, unknown>>,
	startIndex: number,
): docs_v1.Schema$Request[] {
	const requests: docs_v1.Schema$Request[] = [];
	let idx = startIndex;

	for (const item of content ?? []) {
		if (item.type === "heading") {
			const text = `${item.text}\n`;
			requests.push({
				insertText: { location: { index: idx }, text },
			});
			requests.push({
				updateParagraphStyle: {
					range: { startIndex: idx, endIndex: idx + text.length },
					paragraphStyle: {
						namedStyleType: `HEADING_${item.level}`,
					},
					fields: "namedStyleType",
				},
			});
			idx += text.length;
		} else if (item.type === "paragraph") {
			const text = `${item.text}\n`;
			requests.push({
				insertText: { location: { index: idx }, text },
			});
			idx += text.length;
		} else if (item.type === "bulletList") {
			const items = (item.items ?? []) as string[];
			for (const bullet of items) {
				const text = `${bullet}\n`;
				requests.push({
					insertText: { location: { index: idx }, text },
				});
				requests.push({
					updateParagraphStyle: {
						range: {
							startIndex: idx,
							endIndex: idx + text.length,
						},
						paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
						fields: "namedStyleType",
					},
				});
				requests.push({
					createParagraphBullets: {
						range: {
							startIndex: idx,
							endIndex: idx + text.length,
						},
						bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
					},
				});
				idx += text.length;
			}
		}
	}

	return requests;
}

// ── Plugin ────────────────────────────────────────────────────────────

type JsonSchema = Record<string, unknown>;
type SchemaOptions = { description?: string };
type OptionalSchema = JsonSchema & { __optional?: true };

type ToastInput = {
	title: string;
	subtitle?: string;
	variant: "info" | "warning" | "error";
};

type CommandContext = {
	args: string;
	ui: {
		toast(input: ToastInput): void;
		confirm(input: {
			title: string;
			message?: string;
			confirmLabel?: string;
			cancelLabel?: string;
			defaultValue?: boolean;
		}): Promise<boolean>;
		input(input: {
			title: string;
			message?: string;
			placeholder?: string;
			initialValue?: string;
		}): Promise<string | undefined>;
	};
};

type ToolResult = {
	content: Array<
		| { type: "text"; text: string }
		| { type: "image"; data: string; mimeType: string }
	>;
	details?: unknown;
	terminate?: boolean;
};

type ToolDefinition = {
	name: string;
	label?: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: JsonSchema;
	execute(id: string, params: Record<string, any>): Promise<ToolResult>;
};

type CommandDefinition = {
	id: string;
	description: string;
	handler(ctx: CommandContext): void | Promise<void>;
};

const unknownSchema: JsonSchema = {
	anyOf: [
		{ type: "object", additionalProperties: true },
		{ type: "array" },
		{ type: "string" },
		{ type: "number" },
		{ type: "boolean" },
		{ type: "null" },
	],
};

const Schema = {
	String(options: SchemaOptions = {}): JsonSchema {
		return { type: "string", ...options };
	},
	Number(options: SchemaOptions = {}): JsonSchema {
		return { type: "number", ...options };
	},
	Boolean(options: SchemaOptions = {}): JsonSchema {
		return { type: "boolean", ...options };
	},
	Unknown(options: SchemaOptions = {}): JsonSchema {
		return { ...unknownSchema, ...options };
	},
	Optional(schema: JsonSchema): OptionalSchema {
		return { ...schema, __optional: true };
	},
	Object(properties: Record<string, OptionalSchema>): JsonSchema {
		const required: string[] = [];
		const normalized: Record<string, JsonSchema> = {};
		for (const [name, schema] of Object.entries(properties)) {
			const { __optional, ...rest } = schema;
			normalized[name] = rest;
			if (!__optional) required.push(name);
		}
		return {
			type: "object",
			properties: normalized,
			required,
			additionalProperties: false,
		};
	},
};

const endpoint = new KitPluginEndpoint();
const commands = new Map<string, CommandDefinition>();
const tools = new Map<string, ToolDefinition>();

function registerCommand(
	id: string,
	options: { description: string },
	handler: (ctx: CommandContext) => void | Promise<void>,
): void {
	commands.set(id, { id, description: options.description, handler });
}

function registerTool(definition: ToolDefinition): void {
	tools.set(definition.name, definition);
}

function toast(input: ToastInput): void {
	endpoint.toast(input.title, input.variant, input.subtitle);
}

function commandContext(args: string): CommandContext {
	return {
		args,
		ui: {
			toast,
			async confirm(input) {
				return (await endpoint.request("kit/ui/confirm", input)) === true;
			},
			async input(input) {
				const result = await endpoint.request("kit/ui/input", input);
				return typeof result === "string" ? result : undefined;
			},
		},
	};
}
	// ── Auth Command ──────────────────────────────────────────────────

	registerCommand(
		"gdrive-auth",
		{
			description:
				"Set up Google Drive OAuth credentials (stored in macOS Keychain)",
		},
		async (ctx) => {
			if (hasKeychainCreds()) {
				const ok = await ctx.ui.confirm({
					title: "Credentials exist",
					message:
						"Google Drive credentials are already configured. Re-authenticate?",
				});
				if (!ok) return;
			}

			ctx.ui.toast({
				title: "Google OAuth Setup",
				subtitle:
					"Enter your Google OAuth2 credentials. Create them at console.cloud.google.com/apis/credentials (Desktop app type).",
				variant: "info",
			});

			const clientId = await ctx.ui.input({
				title: "Client ID",
				placeholder: "e.g. 123456-abc.apps.googleusercontent.com",
			});
			if (!clientId) return;

			const clientSecret = await ctx.ui.input({
				title: "Client Secret",
				placeholder: "e.g. GOCSPX-...",
			});
			if (!clientSecret) return;

			ctx.ui.toast({
				title: "Opening browser",
				subtitle: "Complete the Google authorization flow...",
				variant: "info",
			});

			try {
				const refreshToken = await runOAuthFlow(clientId, clientSecret);
				keychainSet(KEYCHAIN_CLIENT_ID, clientId);
				keychainSet(KEYCHAIN_CLIENT_SECRET, clientSecret);
				keychainSet(KEYCHAIN_REFRESH_TOKEN, refreshToken);
				_auth = null;

				ctx.ui.toast({
					title: "Google Drive authorized",
					subtitle: "Credentials saved to Keychain.",
					variant: "info",
				});
			} catch (err: unknown) {
				const message =
					err instanceof Error ? err.message : String(err);
				ctx.ui.toast({
					title: "Auth failed",
					subtitle: message,
					variant: "error",
				});
			}
		},
	);

	// ── Search ────────────────────────────────────────────────────────

	registerTool({
		name: "search",
		label: "GDrive: Search",
		description:
			"Search for files and documents across Google Drive. Returns names, IDs, types, and links.",
		promptSnippet: "Search Google Drive for files and documents",
		parameters: Schema.Object({
			query: Schema.String({
				description:
					"Search query (supports Google Drive syntax: 'type:document', 'name:report', or text search)",
			}),
			max_results: Schema.Optional(
				Schema.Number({
					description: "Max results (default: 10, max: 100)",
				}),
			),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const drive = google.drive({ version: "v3", auth });
			const max = Math.min(params.max_results ?? 10, 100);

			const res = await drive.files.list({
				q: `fullText contains '${params.query.replace(/'/g, "\\'")}'`,
				pageSize: max,
				fields: "files(id,name,mimeType,modifiedTime,owners,size,webViewLink)",
				orderBy: "modifiedTime desc",
			});

			const files = res.data.files ?? [];
			if (files.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No files found." }],
					details: {},
				};
			}

			const lines = files.map((f) => {
				const type = f.mimeType?.includes("document")
					? "Google Doc"
					: f.mimeType?.includes("spreadsheet")
						? "Google Sheet"
						: f.mimeType?.includes("presentation")
							? "Google Slides"
							: f.mimeType ?? "File";
				const owner = f.owners?.[0]?.displayName ?? "Unknown";
				return `📄 ${f.name}\n   Type: ${type}\n   ID: ${f.id}\n   Owner: ${owner}\n   Link: ${f.webViewLink}`;
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Found ${files.length} file(s):\n\n${lines.join("\n\n")}`,
					},
				],
				details: {},
			};
		},
	});

	// ── Get Contents ──────────────────────────────────────────────────

	registerTool({
		name: "get_contents",
		label: "GDrive: Get Contents",
		description:
			"Get the contents of a Google Doc or Spreadsheet. Supports markdown (default, preserves structure) or JSON (full document structure for editing).",
		promptSnippet: "Read Google Doc or Sheet contents (markdown or JSON)",
		promptGuidelines: [
			"Always get the doc structure first with gdrive__get_contents format='json' before editing.",
			"Make only ONE operation per call since indices shift after modifications.",
			"Use the updated document structure returned by this tool for subsequent operations.",
		],
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs/Sheets URL or document ID",
			}),
			format: Schema.Optional(
				Schema.String({
					description:
						"'markdown' (default) or 'json' for full structure",
				}),
			),
			range: Schema.Optional(
				Schema.String({
					description:
						"For spreadsheets only: cell range (e.g., 'A1:D10')",
				}),
			),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const format = params.format ?? "markdown";
			const docType = detectDocType(params.doc_id_or_url);

			if (docType === "spreadsheet") {
				const sheets = google.sheets({ version: "v4", auth });
				const range = params.range ?? "Sheet1";
				const res = await sheets.spreadsheets.values.get({
					spreadsheetId: docId,
					range,
				});
				const rows = res.data.values ?? [];
				if (format === "json") {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify(res.data, null, 2),
							},
						],
						details: {},
					};
				}
				if (rows.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Empty spreadsheet range.",
							},
						],
						details: {},
					};
				}
				const header = rows[0] as string[];
				const sep = header.map(() => "---");
				const body = rows
					.slice(1)
					.map((r: string[]) => `| ${r.join(" | ")} |`);
				const table = [
					`| ${header.join(" | ")} |`,
					`| ${sep.join(" | ")} |`,
					...body,
				].join("\n");
				return {
					content: [{ type: "text" as const, text: table }],
					details: {},
				};
			}

			const docs = google.docs({ version: "v1", auth });
			const doc = await docs.documents.get({ documentId: docId });

			if (format === "json") {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(doc.data, null, 2),
						},
					],
					details: {},
				};
			}

			return {
				content: [
					{ type: "text" as const, text: docToMarkdown(doc.data) },
				],
				details: {},
			};
		},
	});

	// ── Comments ──────────────────────────────────────────────────────

	registerTool({
		name: "list_comments",
		label: "GDrive: List Comments",
		description:
			"List all comment threads on a Google Doc, including quoted text, replies, status, and timestamps.",
		promptSnippet: "List comments on a Google Doc",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const drive = google.drive({ version: "v3", auth });

			const res = await drive.comments.list({
				fileId: docId,
				fields: "comments(id,content,author,createdTime,resolved,quotedFileContent,replies(id,content,author,createdTime))",
				pageSize: 100,
			});

			const comments = res.data.comments ?? [];
			if (comments.length === 0) {
				return {
					content: [
						{ type: "text" as const, text: "No comments found." },
					],
					details: {},
				};
			}

			const lines = comments.map((c) => {
				let text = `💬 [comment_id: ${c.id}] (${c.resolved ? "✅ resolved" : "⬜ open"})\n`;
				text += `   Author: ${c.author?.displayName}\n`;
				text += `   Date: ${c.createdTime}\n`;
				if (c.quotedFileContent?.value) {
					text += `   Quoted: "${c.quotedFileContent.value}"\n`;
				}
				text += `   Content: ${c.content}\n`;
				if (c.replies && c.replies.length > 0) {
					for (const r of c.replies) {
						text += `   ↳ ${r.author?.displayName}: ${r.content} (${r.createdTime})\n`;
					}
				}
				return text;
			});

			return {
				content: [
					{
						type: "text" as const,
						text: lines.join("\n"),
					},
				],
				details: {},
			};
		},
	});

	registerTool({
		name: "create_comment",
		label: "GDrive: Create Comment",
		description: "Create an unanchored comment on a Google Doc.",
		promptSnippet: "Add a comment to a Google Doc",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
			comment: Schema.String({ description: "The comment text" }),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const drive = google.drive({ version: "v3", auth });

			const res = await drive.comments.create({
				fileId: docId,
				requestBody: { content: params.comment },
				fields: "id,content,author,createdTime",
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Comment created (ID: ${res.data.id}) by ${res.data.author?.displayName}`,
					},
				],
				details: {},
			};
		},
	});

	registerTool({
		name: "reply_to_comment",
		label: "GDrive: Reply to Comment",
		description:
			"Reply to an existing comment thread. Can optionally resolve the thread.",
		promptSnippet: "Reply to a Google Doc comment thread",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
			comment_id: Schema.String({
				description:
					"Comment thread ID (from gdrive__list_comments)",
			}),
			reply: Schema.String({ description: "Reply text" }),
			resolve: Schema.Optional(
				Schema.Boolean({
					description: "Set true to resolve the thread",
				}),
			),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const drive = google.drive({ version: "v3", auth });

			await drive.replies.create({
				fileId: docId,
				commentId: params.comment_id,
				requestBody: { content: params.reply },
				fields: "id",
			});

			if (params.resolve) {
				const comment = await drive.comments.get({
					fileId: docId,
					commentId: params.comment_id,
					fields: "content",
				});
				await drive.comments.update({
					fileId: docId,
					commentId: params.comment_id,
					requestBody: {
						content: comment.data.content ?? "",
						resolved: true,
					},
					fields: "id,resolved",
				});
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `Reply added to comment ${params.comment_id}${params.resolve ? " (thread resolved)" : ""}`,
					},
				],
				details: {},
			};
		},
	});

	registerTool({
		name: "resolve_comment",
		label: "GDrive: Resolve Comment",
		description:
			"Resolve a comment thread without adding a reply. The comment_id must be the exact ID from gdrive__list_comments.",
		promptSnippet: "Resolve a Google Doc comment thread",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
			comment_id: Schema.String({
				description:
					"The exact comment_id from gdrive__list_comments output",
			}),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const drive = google.drive({ version: "v3", auth });

			let existingContent: string;
			try {
				const comment = await drive.comments.get({
					fileId: docId,
					commentId: params.comment_id,
					fields: "id,content,resolved",
				});
				existingContent = comment.data.content ?? "";
			} catch (err: unknown) {
				const message =
					err instanceof Error ? err.message : String(err);
				throw new Error(
					`Comment not found (id: "${params.comment_id}", doc: "${docId}"). ` +
						`Use gdrive__list_comments to get valid comment IDs. Error: ${message}`,
				);
			}

			await drive.comments.update({
				fileId: docId,
				commentId: params.comment_id,
				requestBody: {
					content: existingContent,
					resolved: true,
				},
				fields: "id,resolved",
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Comment ${params.comment_id} resolved.`,
					},
				],
				details: {},
			};
		},
	});

	// ── Document Editing ──────────────────────────────────────────────

	registerTool({
		name: "update_doc_content",
		label: "GDrive: Update Doc Content",
		description:
			"Add, modify, or delete content in a Google Doc using JSONPath targeting. " +
			"WORKFLOW: (1) Get doc structure with gdrive__get_contents format='json', " +
			"(2) Make ONE operation per call, (3) Use the UPDATED structure returned for next operations. " +
			"Operations: insertAfter, insertBefore, replace, delete, updateTextStyle, updateParagraphStyle. " +
			"Target elements via JSONPath (e.g., '$.body.content[1]').",
		promptSnippet:
			"Edit Google Doc content (insert, replace, delete, style) via JSONPath",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
			operation: Schema.Optional(
				Schema.String({
					description:
						"insertAfter, insertBefore, replace, delete, updateTextStyle, updateParagraphStyle",
				}),
			),
			target: Schema.Optional(
				Schema.String({
					description:
						"JSONPath to target element (e.g., '$.body.content[1]')",
				}),
			),
			content: Schema.Optional(
				Schema.Unknown({
					description:
						"Array of content items: [{type:'heading',level:2,text:'...'}, {type:'paragraph',text:'...'}, {type:'bulletList',items:['...']}]",
				}),
			),
			textStyle: Schema.Optional(
				Schema.Unknown({
					description:
						"Text style: {bold, italic, underline, strikethrough, fontSize, foregroundColor, backgroundColor, link}",
				}),
			),
			paragraphStyle: Schema.Optional(
				Schema.Unknown({
					description:
						"Paragraph style: {headingLevel, alignment, lineSpacing, direction}",
				}),
			),
			requests: Schema.Optional(
				Schema.Unknown({
					description:
						"Raw Google Docs API batchUpdate request objects (advanced)",
				}),
			),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const docs = google.docs({ version: "v1", auth });

			// Raw requests mode
			if (params.requests) {
				const requests =
					params.requests as docs_v1.Schema$Request[];
				await docs.documents.batchUpdate({
					documentId: docId,
					requestBody: { requests },
				});
				return {
					content: [
						{
							type: "text" as const,
							text: `Document updated (${requests.length} request(s) applied).`,
						},
					],
					details: {},
				};
			}

			// JSONPath mode
			if (!params.operation || !params.target) {
				throw new Error(
					"Must provide operation + target, or requests",
				);
			}

			const doc = await docs.documents.get({ documentId: docId });
			const { JSONPath } = await import("jsonpath-plus");
			const results = JSONPath({
				path: params.target,
				json: doc.data,
			});

			if (results.length === 0)
				throw new Error(`No element at: ${params.target}`);
			if (results.length > 1)
				throw new Error(
					`Multiple elements at: ${params.target}`,
				);

			const el = results[0] as Record<string, number>;
			const requests: docs_v1.Schema$Request[] = [];

			if (params.operation === "delete") {
				requests.push({
					deleteContentRange: {
						range: {
							startIndex: el.startIndex,
							endIndex: el.endIndex,
						},
					},
				});
			} else if (params.operation === "replace") {
				const content =
					params.content as Array<Record<string, unknown>>;
				requests.push({
					deleteContentRange: {
						range: {
							startIndex: el.startIndex,
							endIndex: el.endIndex,
						},
					},
				});
				requests.push(
					...buildContentRequests(content, el.startIndex),
				);
			} else if (
				params.operation === "insertAfter" ||
				params.operation === "insertBefore"
			) {
				const content =
					params.content as Array<Record<string, unknown>>;
				const idx =
					params.operation === "insertAfter"
						? el.endIndex
						: el.startIndex;
				requests.push(...buildContentRequests(content, idx));
			} else if (
				params.operation === "updateTextStyle" &&
				params.textStyle
			) {
				const ts = params.textStyle as Record<string, unknown>;
				const style: docs_v1.Schema$TextStyle = {};
				const fields: string[] = [];
				if (ts.bold !== undefined) {
					style.bold = ts.bold as boolean;
					fields.push("bold");
				}
				if (ts.italic !== undefined) {
					style.italic = ts.italic as boolean;
					fields.push("italic");
				}
				if (ts.underline !== undefined) {
					style.underline = ts.underline as boolean;
					fields.push("underline");
				}
				if (ts.strikethrough !== undefined) {
					style.strikethrough = ts.strikethrough as boolean;
					fields.push("strikethrough");
				}
				if (ts.fontSize) {
					style.fontSize = {
						magnitude: ts.fontSize as number,
						unit: "PT",
					};
					fields.push("fontSize");
				}
				if (ts.foregroundColor) {
					style.foregroundColor = {
						color: {
							rgbColor:
								ts.foregroundColor as docs_v1.Schema$Color,
						},
					};
					fields.push("foregroundColor");
				}
				if (ts.backgroundColor) {
					style.backgroundColor = {
						color: {
							rgbColor:
								ts.backgroundColor as docs_v1.Schema$Color,
						},
					};
					fields.push("backgroundColor");
				}
				if (ts.link) {
					style.link = {
						url: (ts.link as Record<string, string>).url,
					};
					fields.push("link");
				}
				requests.push({
					updateTextStyle: {
						range: {
							startIndex: el.startIndex,
							endIndex: el.endIndex,
						},
						textStyle: style,
						fields: fields.join(","),
					},
				});
			} else if (
				params.operation === "updateParagraphStyle" &&
				params.paragraphStyle
			) {
				const ps = params.paragraphStyle as Record<string, unknown>;
				const style: docs_v1.Schema$ParagraphStyle = {};
				const fields: string[] = [];
				if (ps.headingLevel) {
					style.namedStyleType = ps.headingLevel as string;
					fields.push("namedStyleType");
				}
				if (ps.alignment) {
					style.alignment = ps.alignment as string;
					fields.push("alignment");
				}
				if (ps.lineSpacing !== undefined) {
					style.lineSpacing = ps.lineSpacing as number;
					fields.push("lineSpacing");
				}
				if (ps.direction) {
					style.direction = ps.direction as string;
					fields.push("direction");
				}
				requests.push({
					updateParagraphStyle: {
						range: {
							startIndex: el.startIndex,
							endIndex: el.endIndex,
						},
						paragraphStyle: style,
						fields: fields.join(","),
					},
				});
			}

			if (requests.length === 0)
				throw new Error("No valid operation built");

			await docs.documents.batchUpdate({
				documentId: docId,
				requestBody: { requests },
			});

			const updated = await docs.documents.get({
				documentId: docId,
			});
			return {
				content: [
					{
						type: "text" as const,
						text: `Document updated (${params.operation} at ${params.target}).\n\nUPDATED DOCUMENT STRUCTURE:\n${JSON.stringify(updated.data, null, 2)}`,
					},
				],
				details: {},
			};
		},
	});

	registerTool({
		name: "find_replace",
		label: "GDrive: Find & Replace",
		description:
			"Find and replace all occurrences of text in a Google Doc. Returns the number of replacements made.",
		promptSnippet: "Find and replace text in a Google Doc",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
			find_text: Schema.String({ description: "Text to find" }),
			replace_text: Schema.String({
				description: "Replacement text",
			}),
			match_case: Schema.Optional(
				Schema.Boolean({
					description: "Case-sensitive match (default: false)",
				}),
			),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const docs = google.docs({ version: "v1", auth });

			const res = await docs.documents.batchUpdate({
				documentId: docId,
				requestBody: {
					requests: [
						{
							replaceAllText: {
								containsText: {
									text: params.find_text,
									matchCase: params.match_case ?? false,
								},
								replaceText: params.replace_text,
							},
						},
					],
				},
			});

			const count =
				res.data.replies?.[0]?.replaceAllText
					?.occurrencesChanged ?? 0;
			return {
				content: [
					{
						type: "text" as const,
						text: `Replaced ${count} occurrence(s) of "${params.find_text}" with "${params.replace_text}".`,
					},
				],
				details: {},
			};
		},
	});

	registerTool({
		name: "append_text",
		label: "GDrive: Append Text",
		description:
			"Append text to the end of a Google Doc. Automatically finds the end of the document.",
		promptSnippet: "Append text to the end of a Google Doc",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
			text: Schema.String({
				description: "Text to append (supports newlines)",
			}),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const docs = google.docs({ version: "v1", auth });

			const doc = await docs.documents.get({ documentId: docId });
			const body = doc.data.body?.content ?? [];
			const lastEl = body[body.length - 1];
			const endIndex = (lastEl?.endIndex ?? 2) - 1;

			const insertText = params.text.endsWith("\n")
				? params.text
				: `${params.text}\n`;
			await docs.documents.batchUpdate({
				documentId: docId,
				requestBody: {
					requests: [
						{
							insertText: {
								location: { index: endIndex },
								text: insertText,
							},
						},
					],
				},
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Appended ${insertText.length} characters to document.`,
					},
				],
				details: {},
			};
		},
	});

	registerTool({
		name: "create_doc",
		label: "GDrive: Create Document",
		description:
			"Create a new Google Doc with a title and optional initial text content. Returns the document ID and URL.",
		promptSnippet: "Create a new Google Doc",
		parameters: Schema.Object({
			title: Schema.String({ description: "Document title" }),
			content: Schema.Optional(
				Schema.String({ description: "Initial text content" }),
			),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docs = google.docs({ version: "v1", auth });

			const res = await docs.documents.create({
				requestBody: { title: params.title },
			});
			const docId = res.data.documentId!;

			if (params.content) {
				await docs.documents.batchUpdate({
					documentId: docId,
					requestBody: {
						requests: [
							{
								insertText: {
									location: { index: 1 },
									text: params.content,
								},
							},
						],
					},
				});
			}

			const url = `https://docs.google.com/document/d/${docId}/edit`;
			return {
				content: [
					{
						type: "text" as const,
						text: `Document created!\n\nTitle: ${params.title}\nID: ${docId}\nURL: ${url}`,
					},
				],
				details: {},
			};
		},
	});

	// ── Notes (inline styled blocks) ─────────────────────────────────

	registerTool({
		name: "insert_note",
		label: "GDrive: Insert Note",
		description:
			"Insert a styled note block (📝 NOTE #:) into a Google Doc after a paragraph containing the search text.",
		promptSnippet: "Insert an inline note in a Google Doc",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
			search_text: Schema.String({
				description:
					"Exact text to search for; note is inserted after this paragraph",
			}),
			note: Schema.String({
				description: "Note text (prefix added automatically)",
			}),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const docs = google.docs({ version: "v1", auth });

			const doc = await docs.documents.get({ documentId: docId });
			const body = doc.data.body?.content ?? [];

			let noteCount = 0;
			let insertIndex: number | null = null;

			for (const el of body) {
				const text = (el.paragraph?.elements ?? [])
					.map((e) => e.textRun?.content ?? "")
					.join("");
				if (text.includes("📝 NOTE")) noteCount++;
				if (
					insertIndex === null &&
					text.includes(params.search_text)
				) {
					insertIndex = el.endIndex!;
				}
			}

			if (insertIndex === null) {
				throw new Error(
					`Text not found: "${params.search_text}"`,
				);
			}

			const noteNum = noteCount + 1;
			const noteText = `📝 NOTE ${noteNum}: ${params.note}\n`;

			await docs.documents.batchUpdate({
				documentId: docId,
				requestBody: {
					requests: [
						{
							insertText: {
								location: { index: insertIndex },
								text: noteText,
							},
						},
						{
							updateParagraphStyle: {
								range: {
									startIndex: insertIndex,
									endIndex:
										insertIndex + noteText.length,
								},
								paragraphStyle: {
									namedStyleType: "NORMAL_TEXT",
								},
								fields: "namedStyleType",
							},
						},
						{
							updateTextStyle: {
								range: {
									startIndex: insertIndex,
									endIndex:
										insertIndex + noteText.length,
								},
								textStyle: {
									backgroundColor: {
										color: {
											rgbColor: {
												red: 1,
												green: 0.95,
												blue: 0.8,
											},
										},
									},
									bold: true,
								},
								fields: "backgroundColor,bold",
							},
						},
					],
				},
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Inserted NOTE ${noteNum} after "${params.search_text}".`,
					},
				],
				details: {},
			};
		},
	});

	registerTool({
		name: "update_note",
		label: "GDrive: Update Note",
		description: "Update the text of an existing note by its number.",
		promptSnippet: "Update an existing note in a Google Doc",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
			note_number: Schema.Number({
				description: "Note number (e.g., 1 for 📝 NOTE 1:)",
			}),
			new_text: Schema.String({ description: "New note text" }),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const docs = google.docs({ version: "v1", auth });
			const doc = await docs.documents.get({ documentId: docId });
			const body = doc.data.body?.content ?? [];

			const notePrefix = `📝 NOTE ${params.note_number}:`;
			for (const el of body) {
				const text = (el.paragraph?.elements ?? [])
					.map((e) => e.textRun?.content ?? "")
					.join("");
				if (text.includes(notePrefix)) {
					const prefixEnd = text.indexOf(":") + 2;
					const noteStart = el.startIndex! + prefixEnd;
					const noteEnd = el.endIndex! - 1;

					await docs.documents.batchUpdate({
						documentId: docId,
						requestBody: {
							requests: [
								{
									deleteContentRange: {
										range: {
											startIndex: noteStart,
											endIndex: noteEnd,
										},
									},
								},
								{
									insertText: {
										location: {
											index: noteStart,
										},
										text: params.new_text,
									},
								},
							],
						},
					});

					return {
						content: [
							{
								type: "text" as const,
								text: `Updated NOTE ${params.note_number}.`,
							},
						],
						details: {},
					};
				}
			}

			throw new Error(`NOTE ${params.note_number} not found`);
		},
	});

	registerTool({
		name: "remove_note",
		label: "GDrive: Remove Note",
		description:
			"Remove a note from a Google Doc by its number.",
		promptSnippet: "Remove a note from a Google Doc",
		parameters: Schema.Object({
			doc_id_or_url: Schema.String({
				description: "Google Docs URL or document ID",
			}),
			note_number: Schema.Number({
				description: "Note number to remove",
			}),
		}),
		async execute(_id, params) {
			const auth = getAuth();
			const docId = extractDocId(params.doc_id_or_url);
			const docs = google.docs({ version: "v1", auth });
			const doc = await docs.documents.get({ documentId: docId });
			const body = doc.data.body?.content ?? [];

			const notePrefix = `📝 NOTE ${params.note_number}:`;
			for (const el of body) {
				const text = (el.paragraph?.elements ?? [])
					.map((e) => e.textRun?.content ?? "")
					.join("");
				if (text.includes(notePrefix)) {
					await docs.documents.batchUpdate({
						documentId: docId,
						requestBody: {
							requests: [
								{
									deleteContentRange: {
										range: {
											startIndex: el.startIndex!,
											endIndex: el.endIndex!,
										},
									},
								},
							],
						},
					});

					return {
						content: [
							{
								type: "text" as const,
								text: `Removed NOTE ${params.note_number}.`,
							},
						],
						details: {},
					};
				}
			}

			throw new Error(`NOTE ${params.note_number} not found`);
		},
	});

endpoint.onInitialize(
	(params) => {
		if (params.protocolVersion !== 1) throw new Error("Unsupported protocol version");
		return { protocolVersion: 1 };
	},
	async () => {
		for (const command of commands.values()) {
			await endpoint.request("kit/commands/register", {
				id: command.id,
				description: command.description,
				category: "Google Drive",
			});
		}
		for (const tool of tools.values()) {
			await endpoint.request("kit/tools/register", {
				id: tool.name,
				label: tool.label ?? tool.name,
				description: tool.description,
				inputSchema: tool.parameters,
				executionMode: "sequential",
				...(tool.promptSnippet ? { promptSnippet: tool.promptSnippet } : {}),
				...(tool.promptGuidelines ? { promptGuidelines: tool.promptGuidelines } : {}),
			});
		}
	},
);

endpoint.onRequest("kit/commands/execute", async (params) => {
	const id = typeof params.id === "string" ? params.id : "";
	const command = commands.get(id);
	if (!command) throw new Error(`Unknown Google Drive command: ${id}`);
	await command.handler(commandContext(typeof params.args === "string" ? params.args : ""));
	return null;
});

endpoint.onRequest("kit/tools/execute", async (params) => {
	const id = typeof params.id === "string" ? params.id : "";
	const tool = tools.get(id);
	if (!tool) throw new Error(`Unknown Google Drive tool: ${id}`);
	const input = params.input && typeof params.input === "object"
		? params.input as Record<string, unknown>
		: {};
	return tool.execute(
		typeof params.toolCallId === "string" ? params.toolCallId : "",
		input,
	);
});

endpoint.start();
