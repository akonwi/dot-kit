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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { type Infer, type JsonValue, type Kit, runPlugin, t } from "./kit-plugin.ts";

export const ACTIONS_PATH = path.join(homedir(), ".cowork", "actions.json");

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

const ToolInput = t.object({
	action: t.enum(["list", "add", "edit", "complete", "reopen"]),
	id: t.optional(t.string({ description: "Item id — required for edit, complete, and reopen. Get it from 'list' first." })),
	text: t.optional(t.string({ description: "The action item's text. Required for add; optional for edit." })),
	group: t.optional(
		t.enum(["immediate", "this_week"], {
			description: "immediate = blocking or due very soon; this_week = everything else open-ended. Defaults to this_week on add.",
		}),
	),
	due_at: t.optional(
		t.string({
			description:
				"Explicit deadline as YYYY-MM-DD. Leave unset unless the user actually stated one — cowork falls back to a sensible default based on group.",
		}),
	),
	parent_id: t.optional(
		t.string({ description: "Id of a parent item, to add/edit this as a nested sub-task. Leave unset for a top-level item." }),
	),
	// Set by cowork's own extraction pipeline when it prompts a headless
	// session to add items directly via this tool (cowork's ADR 0013) —
	// not something an interactive user would normally set themselves.
	source_meeting: t.optional(
		t.string({
			description:
				"Internal: the source meeting's id, when this item is being added on behalf of an automated extraction pass rather than direct conversation. Leave unset otherwise.",
		}),
	),
});
type ToolInput = Infer<typeof ToolInput>;

function textResult(text: string, details: JsonValue = null) {
	return { content: [{ type: "text" as const, text }], details };
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
				source_meeting: input.source_meeting ?? "",
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

// ── Plugin ─────────────────────────────────────────────────────────────────

export async function setup(kit: Kit) {
	await kit.tools.register({
		id: "actions",
		label: "Cowork Actions",
		description: "Create, edit, complete, or reopen items in cowork's aggregate action-item list.",
		input: ToolInput,
		executionMode: "sequential",
		promptSnippet: "Manage cowork's aggregate action-item list",
		promptGuidelines: [
			`Items live in ${ACTIONS_PATH}, shared across every project — this is the user's one aggregate to-do list, not scoped to the current project.`,
			"Call 'list' first when you need an item's id (for edit/complete/reopen) or want to check what's already open before adding something that might be a duplicate.",
			"An item only disappears from 'list' once it's completed — nothing expires or gets cleaned up on its own.",
			"Only set due_at when the user actually stated a deadline. Otherwise leave it unset — cowork computes a sensible default (immediate items: ~1 day, everything else: ~1 week) and a separate scheduled check nudges the user about anything overdue.",
		],
		execute: (input) => executeTool(input),
	});
}

if (import.meta.main) runPlugin(setup);
