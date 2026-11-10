// Registration only: the tools and the auth command reach the macOS
// Keychain and Google's APIs, so these tests never call them.
import { expect, test } from "bun:test";
import { startTestPlugin } from "./kit-plugin-testing.ts";
import { setup } from "./plugin.ts";

test("registers the auth command and every tool with schemas Kit accepts", async () => {
  const kit = await startTestPlugin(setup, { pluginId: "gdrive" });
  expect(kit.exitCode).toBeUndefined();
  expect(kit.commands.get("gdrive-auth")).toEqual({
    id: "gdrive-auth",
    description: "Set up Google Drive OAuth credentials (stored in macOS Keychain)",
    category: "Google Drive",
  });
  expect(kit.tools.size).toBe(13);
  expect(kit.tools.get("search")?.inputSchema).toEqual({
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (supports Google Drive syntax: 'type:document', 'name:report', or text search)",
      },
      max_results: { type: "number", description: "Max results (default: 10, max: 100)" },
    },
    required: ["query"],
    additionalProperties: false,
  });
  await kit.shutdown();
  expect(kit.exitCode).toBe(0);
});
