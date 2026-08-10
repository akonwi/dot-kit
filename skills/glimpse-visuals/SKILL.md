---
name: glimpse-visuals
description: Show visual artifacts in native OS windows using the glimpse CLI — HTML previews, images, reports, dashboards, dialogs — with optional JSON results back from the page. Use when the user should see or interact with something visual instead of reading about it in the terminal.
---

# Glimpse: native windows for visual artifacts

The `glimpse` CLI ([HazAT/glimpse](https://github.com/HazAT/glimpse), npm
`glimpseui`) renders HTML in a small native WebView window — no Electron,
no browser tab — and prints JSON envelopes, so scripts and agents can
show something and optionally wait for what the user does with it.

Disambiguation: `u1i/glimpse` is an unrelated image-analysis CLI with a
colliding binary name. Verify with `glimpse --version` — the windowing
CLI answers; the analysis tool wants an image path.

## Core commands

**`prompt` — one-shot dialog.** Opens, blocks until the page sends one
result (or the user cancels/closes), prints it as JSON, closes:

```bash
glimpse prompt --title "Review" --width 900 --height 700 artifact.html
```

**`open` — persistent window**, addressable by name:

```bash
glimpse open --name preview --replace --width 1000 --height 700 --url http://localhost:3000/
glimpse set-html -w preview updated.html      # swap content
glimpse navigate -w preview --url http://localhost:3000/other
glimpse wait -w preview --timeout 60s         # block for the next page event
glimpse send -w preview --type app.update --data '{"status":"done"}'  # push into the page
glimpse read -w preview                       # consume next event (peek/events: inspect only)
```

`--name X --replace` makes reruns idempotent — the window is reused
instead of stacking duplicates. **But replace destroys the old window's
unread event queue** — drain pending events first (see the feedback
section below).

## HTML sources

`[html-source]` is a file path or `-` for stdin; `--html '<...>'` suits
short inline snippets. Inline/file HTML automatically gets the glimpse
bridge: page scripts call `window.glimpse.send({...})` to return data.
Custom event types must avoid the reserved prefixes `window.*`, `html.*`,
`glimpse.*`. Cancel and window-close produce explicit result objects —
always handle the no-result case.

## The URL-iframe gotcha (this is what bites hardest)

**URL-loaded windows (`open --url`, `prompt --url`) wrap the page in an
iframe inside an `about:blank` wrapper, and the bridge lives in the
wrapper** — `window.glimpse` is undefined inside your page, so
`glimpse.send(...)` silently does nothing (verify: `glimpse eval -w X
'location.href'` prints `about:blank`). For interactive pages, either:

- load the HTML as a **file** (bridge injects directly into the page), or
- have the page call `parent.postMessage(data, '*')` and install a relay
  in the wrapper:

```bash
glimpse eval -w X "window.addEventListener('message', e => window.glimpse.send(e.data))"
```

Plain viewing via `--url` is unaffected. `glimpse eval -w X '<js>'` runs
in the wrapper and is the debugging tool of choice (results arrive as
`eval.result` events via `read`/`events`).

## Security model (also bites)

- Inline/file HTML runs under a **restrictive default CSP** — external
  stylesheets, images, and scripts won't load. Loosen with
  `--allow-remote-resources` or a custom `--csp`, or serve the artifact
  and open it by URL instead.
- Loopback URLs are trusted by default. Non-loopback URLs need
  `--allow-remote`, and only receive the bridge with `--allow-bridge`.

Rule of thumb: self-contained HTML → pass the file; anything with
dependencies → serve it locally and use `--url`.

## Window styling

Flags combine freely: `--frameless` (bring your own chrome),
`--floating` (always on top), `--transparent`, `--click-through`.
Plain framed windows are right for most artifact viewing; `--floating`
suits status/companion panels.

## Interaction, when it's useful

Because the page can send JSON back, a window can be a question as well
as a display: forms, confirmations, or a set of options with buttons
wired to `glimpse.send(...)` under `prompt` all return structured
results to the calling script. Use interaction when a decision is being
requested; plain `open` when the artifact just needs to be seen.

## Collecting feedback — you MUST block on the events (submissions get lost otherwise)

Showing a feedback UI is not enough. `glimpse.send(...)` only *queues*
an event on the window record; nothing is delivered unless a CLI
command consumes it, and **the queue is destroyed when the window
closes — including via `open --replace`**. The three ways submissions
have actually been lost:

1. The agent opened the window, ended its turn, and never ran
   `wait`/`read`. The user clicked Submit into a queue nobody read.
2. The user submitted, then closed the window (natural!) — queue gone.
3. The agent iterated with `open --name X --replace` — the replace
   closed the old window and wiped its unread events.

So, immediately after showing any UI with a submit action, block for
the result **in the same shell step**, with a generous tool timeout
(humans take minutes, not seconds — set the Bash tool timeout to
~300000ms and tell the user the window is waiting):

```bash
# loop past window.ready / eval.result noise until a real event
while true; do
  ev=$(glimpse wait -w feedback --timeout 240s) || break
  case "$ev" in
    *'"type":"window.ready"'*|*'"type":"eval.result"'*) continue ;;
    *) echo "$ev"; break ;;   # submission or window.closed
  esac
done
```

Rules:

- **Never `close` or `open --replace` a window that might hold unread
  feedback** — drain first with `glimpse events -w X` (inspect) or
  `read` (consume).
- `glimpse prompt` blocks until the answer, and **if the CLI process is
  killed, the dialog vanishes with it** — a default 120s Bash timeout
  will yank the dialog out from under a user mid-answer. Always pass an
  explicit long tool timeout when running `prompt`.
- Handle `window.closed` as an explicit "no answer" outcome, and a
  `wait` timeout as "user hasn't responded yet" (the window is still
  up; you can wait again next turn — events queued in between survive
  as long as the window stays open).

`glimpse skills view` prints the tool's own bundled agent docs for
deeper protocol detail.
