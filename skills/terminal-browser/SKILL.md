---
name: terminal-browser
description: Quickly open a URL or local HTML file in a terminal-browser pane beside Kit, especially in Ghostty. Use this for previewing or visiting something in a terminal split, not for browser automation, snapshots, screenshots, or collecting visual feedback.
---

# Terminal-browser split

Use `terminal-browser` when the user wants a URL or local HTML artifact opened
quickly beside the current Kit pane.

## Open a target

```bash
terminal-browser open <url-or-path> --split right
```

Examples:

```bash
terminal-browser open https://example.com --split right
terminal-browser open ./report.html --split right
terminal-browser open ./report.html --split down --size 0.4
```

Resolve relative paths from the active project directory. Prefer opening local
HTML files directly; use a URL when the artifact needs a local server or remote
resources.

## Scope

This skill is intentionally narrow:

- Use `terminal-browser open` for a quick URL or local-HTML split.
- Do not use it for snapshots, DOM evaluation, clicks, form filling, or
  screenshots; use the `aside-browser` skill for browser automation and
  inspection.
- Do not use it for interactive HTML mockups or collecting visual feedback;
  use the `glimpse-visuals` skill instead.

## Requirements and failures

`terminal-browser` must be installed and the current terminal must support
splitting. In Ghostty, split automation currently requires Ghostty 1.3.0 or
newer on macOS and may require macOS automation permission. If opening fails,
report the command error and suggest checking `terminal-browser --version` and
Ghostty permissions rather than attempting to reproduce its pane management.

The split direction may be `right`, `left`, `down`, or `up`; `--size` accepts a
fraction from `0.2` to `0.95` and only applies with `--split`.
