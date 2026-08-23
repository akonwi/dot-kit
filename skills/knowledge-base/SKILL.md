---
name: knowledge-base
description: Search, retrieve, and archive durable knowledge with the local `kb` CLI. Use whenever the user asks to search the knowledge base, find prior project/session decisions, archive a Kit or coding session, write a work journal, or preserve outcomes for later retrieval.
---

Use the local `kb` CLI as the interface to the user's Markdown knowledge base. Prefer `kb` over searching raw Kit JSONL when durable archived knowledge should answer the question.

For session archival, work-journal, or preservation requests, read `~/.kit/prompts/archive.md` and follow it. Archive-specific instructions live in that prompt; this skill owns general `kb` usage.

## CLI availability

Confirm that `kb` is installed and available on `PATH` before using it:

```sh
which kb
```

- If `which kb` succeeds, use that installed command.
- If it fails, inform the user that `kb` is not installed or not available on `PATH` and ask whether they want to install it.
- Do not install `kb`, modify `PATH`, or guess at an unlisted binary location without the user's confirmation.
- After the user confirms, prefer the documented Homebrew installation on supported macOS/Linux systems:

  ```sh
  brew install akonwi/tap/kb
  ```

- Verify installation with `which kb` and `kb version` before continuing the original knowledge-base task.

Start by discovering current collections when needed:

```sh
kb collection list
kb status
```

Collection names can contain spaces and must be shell-quoted.

## Updating the index

`kb` does not watch the filesystem. Update a collection after its Markdown files are created, edited, moved, or removed:

```sh
kb update "Collection name"
```

Prefer the narrowest relevant update. Update every configured collection only when the user requests a full refresh or changes span multiple collections:

```sh
kb update
```

Normal updates avoid rereading unchanged document bodies by comparing path, size, and nanosecond mtime. Use verification mode when timestamps may be unreliable, after restoring files from backup, or when the user explicitly asks for a complete rehash:

```sh
kb update "Collection name" --verify
kb update --verify
```

After updating, verify expected material with a focused search:

```sh
kb search "distinctive terms" --collection "Collection name" --limit 5
```

- If recently changed Markdown is missing, update only the relevant collection and retry.
- Do not reflexively update every collection before ordinary searches.
- Report indexing failures and do not claim new or changed knowledge is available until search verification succeeds.

## Search and retrieval

Search broadly first, then narrow by collection when useful:

```sh
kb search "query terms" --json
kb search "query terms" --collection "Coding sessions" --limit 20 --json
kb get 'collection/relative-path'
kb get '<content-id>'
kb get 'collection/relative-path' --lines 10:30 --number
```

- Use JSON output for reliable paths, IDs, titles, snippets, and scores.
- Retrieve the full document before making claims that depend on context outside a snippet.
- Cite the collection virtual path, and include the content ID when useful.
- Search synonymous terms or explicit prefixes if the first query is too narrow.
- Do not run `cleanup`, remove collections, or import replacement configuration unless the user explicitly requests it.
