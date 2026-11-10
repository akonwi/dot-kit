import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startTestPlugin } from "./kit-plugin-testing.ts";

// The plugin writes ~/.cowork/actions.json, and Bun reads HOME only at
// startup, so run these tests as `HOME="$(mktemp -d)" bun test`. Refuse to
// touch a real home.
const { ACTIONS_PATH, setup } = await import("./plugin.ts");
const home = path.dirname(path.dirname(ACTIONS_PATH));
if (!realpathSync(home).startsWith(realpathSync(tmpdir()))) {
  throw new Error(`HOME is ${home}; run these tests with HOME set to a temporary directory`);
}

test("registers the actions tool and manages items in ~/.cowork/actions.json", async () => {
  const kit = await startTestPlugin(setup, { pluginId: "cowork" });
  expect(kit.tools.get("actions")?.inputSchema.required).toEqual(["action"]);

  const added = await kit.callTool("actions", { action: "add", text: "Write the report", group: "immediate" });
  const item = (added.details as { item: { id: string } }).item;
  expect(added.content).toEqual([
    { type: "text", text: expect.stringMatching(new RegExp(`^Added: \\[${item.id}\\] \\(open\\) Write the report \\(due \\d{4}-\\d{2}-\\d{2}\\)$`)) },
  ]);

  const listed = await kit.callTool("actions", { action: "list" });
  expect(listed.content[0]).toMatchObject({ text: expect.stringContaining("Write the report") });

  const completed = await kit.callTool("actions", { action: "complete", id: item.id });
  expect(completed.content).toEqual([{ type: "text", text: `Completed: [${item.id}] Write the report` }]);
  expect(await kit.callTool("actions", { action: "list" })).toEqual({
    content: [{ type: "text", text: "No open action items." }],
    details: { items: [] },
  });

  const saved = JSON.parse(readFileSync(path.join(home, ".cowork", "actions.json"), "utf8"));
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0].completed_at).not.toBe("");
});
