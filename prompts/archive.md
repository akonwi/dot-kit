---
description: Archive the current Kit session into the local knowledge base
---
Activate the `knowledge-base` skill for `kb` CLI guidance, then execute the archival workflow below. Do not merely draft or describe the archive: write or update the Markdown entry, index it, verify that it is searchable, and report the path written.

Optional focus supplied by the user: $@

If no focus was supplied, infer the project and topic from the session.

## 1. Resolve the archive collection

The default work-journal collection is `Coding sessions`. Resolve its configured root instead of assuming a directory:

```sh
kb collection show "Coding sessions" --json
```

If the collection is missing, stop and ask where the archive should live rather than inventing or silently creating a collection.

## 2. Gather evidence

Summarize durable outcomes from available evidence:

- the current conversation and active scratchpad;
- current working directory and project documentation;
- `git status --short --branch`;
- relevant `git log --oneline` entries;
- changed files or diff summaries;
- tests, builds, benchmarks, and validation actually run;
- decisions, constraints, unresolved issues, and next steps stated in the session.

Do not claim work that was merely proposed. Distinguish committed work from uncommitted changes.

## 3. Find an existing entry

Before writing, search `Coding sessions` for the project, topic, date, and distinctive decisions. Also inspect likely files under the configured root.

- Update an existing entry when it clearly represents the same work thread/session.
- Otherwise create `YYYY-MM-DD-<project-or-topic>.md`.
- If that filename belongs to different work, add a concise distinguishing suffix instead of overwriting it.

## 4. Write durable Markdown

Use concise frontmatter when appropriate:

```yaml
---
date: YYYY-MM-DD
project: project-name
repository: /absolute/path
status: active
tags:
  - kit-session
---
```

A useful entry normally contains:

- `#` descriptive title;
- `## Summary`;
- `## Completed` or `## Outcomes`;
- `## Decisions`;
- `## Validation`;
- `## Open issues` when applicable;
- `## Next steps`.

Include important commit hashes, file paths, commands, measurements, and error resolutions when they improve future retrieval. Prefer a synthesized journal over a turn-by-turn transcript.

Never archive:

- API keys, tokens, credentials, cookies, or private keys;
- raw authentication/configuration secrets;
- hidden chain-of-thought or private reasoning;
- irrelevant command output or the complete conversation transcript;
- sensitive personal/customer data unless the user explicitly requests it and the destination is appropriate.

## 5. Index and verify

After writing or updating the entry:

```sh
kb update "Coding sessions"
kb search "distinctive verification terms" --collection "Coding sessions" --limit 5
```

Confirm that the intended virtual path is returned. If indexing fails, preserve the Markdown file, report the error, and do not claim archival succeeded.

## 6. Report

Report:

- whether an entry was created or updated;
- the absolute file path and knowledge-base virtual path;
- the main topics preserved;
- indexing and search verification results;
- any omissions or unresolved errors.

## Raw Kit session history

`~/.kit/sessions/*.jsonl` is a fallback source, not the durable knowledge base. Session compaction can remove earlier turns, and raw logs contain noisy operational detail. Use raw session history only when archived Markdown and current evidence are insufficient; synthesize useful outcomes rather than copying JSONL or a complete transcript.

For bulk historical seeding requested by the user:

- process only primary `~/.kit/sessions/*.jsonl` files, not `subagents/`;
- exclude the currently active session unless requested;
- parse large files incrementally and prioritize headers, compaction summaries, user goals, completed assistant messages, decisions, commits, tests, and final state;
- skip empty or content-free sessions with an explicit reason;
- consolidate continuations that represent one logical work thread;
- add a `kit_session_ids` frontmatter list to generated entries;
- maintain `<collection-root>/.kit-session-archive-state.json` as an idempotence manifest mapping every processed ID to its archive path or skipped reason;
- preserve existing manifest entries and never modify source session logs;
- write the batch first, run one collection update, then verify representative entries.
