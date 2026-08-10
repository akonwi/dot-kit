# Tool Approval plugin

A global Kit plugin that asks for confirmation before selected risky shell commands in enabled projects.

## Enable or disable the current project

Run `/toggle-tool-approval`. The plugin updates `config.json` and shows the resulting state.

## Configuration

`config.json` contains absolute project directories:

```json
{
  "enabledProjects": [
    "/Users/example/Developer/project"
  ]
}
```

Paths are resolved to canonical absolute paths when the plugin loads. After editing the file manually, run `/reload`.

The current risky command patterns are `git commit` and `npm publish`.
