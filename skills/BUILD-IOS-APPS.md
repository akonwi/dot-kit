# Build iOS Apps skill export

Source: OpenAI `build-ios-apps` plugin, version **0.1.2**.
Upstream: https://github.com/openai/plugins
License: MIT, as declared by the source plugin manifest.

All nine skill directories are copied unchanged from the installed plugin, including agent metadata, reference documents, scripts, and templates:

- `ios-app-intents`
- `ios-debugger-agent`
- `ios-ettrace-performance`
- `ios-memgraph-leaks`
- `ios-simulator-browser`
- `swiftui-liquid-glass`
- `swiftui-performance-audit`
- `swiftui-ui-patterns`
- `swiftui-view-refactor`

These are repository-local skill copies, not an installation of the plugin or its runtime dependencies. The repository's existing `.mcp.json` contains XcodeBuildMCP, Apple documentation, and simulator entries; it is preserved rather than replaced by the plugin configuration. The upstream plugin uses `npx -y xcodebuildmcp@latest mcp` with simulator, UI automation, debugging, and logging workflows enabled. MCP configuration support depends on the agent client; the installed Codex plugin continues to supply its own tools.

Profiling, leak analysis, and simulator-browser workflows may require additional tools documented in their skills. Copying a skill does not install or validate those tools. Local project instructions and user decisions take precedence over generic exported guidance.

To update, compare against a newer plugin version and copy each complete skill directory so relative references and supporting scripts remain together.
