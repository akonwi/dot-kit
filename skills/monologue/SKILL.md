---
name: monologue
description: Work with Monologue meeting notes via the Monologue CLI and sync notes into the local knowledge base.
---

Use this skill when the user asks about meetings, transcripts, action items, or wants to sync Monologue notes locally.

## What to use

- **Monologue CLI** (`monologue`) for listing, searching, and fetching notes.
- **`/meeting-sync` prompt command** for local ingestion to `~/Developer/meetings/`.

## Preferred workflow

1. For questions like “what did we decide?” or “what were my action items?”, search Monologue first:
   - `monologue notes list --limit 5` for recent notes
   - `monologue notes all --q "search terms" --limit 100` for broader search across titles, summaries, and transcripts
   - `monologue notes get <note_id>` for a full note with summary and transcript
   - `monologue notes get <note_id> --field transcript` for exact transcript text
2. Preserve note IDs in responses when possible.
3. If the user wants local searchable archives, run `/meeting-sync`.

## Sync behavior to know

The sync script (`~/.kit/meeting-sync/sync.ts`) does the following:

- pulls notes from Monologue (default: notes created this week; `--range` = last 30 days)
- optionally filters with `--query "..."`
- writes markdown files to `~/Developer/meetings/`
- tracks synced IDs in `~/Developer/meetings/.meeting-sync-state.json`
- names files as `YYYY-MM-DD-<slug>.md`
- runs `qmd update` after new files are written

## Auth

Monologue auth is managed by the Monologue CLI. If auth fails, run:

```bash
monologue onboarding
```

or set `MONOLOGUE_API_TOKEN` in the environment. Do not store API tokens in Kit prompt/skill files or sync scripts.

## Response expectations

When reporting back, include:

- what was queried/synced
- key findings or extracted decisions/actions
- file paths written (for sync)
- any auth or tool errors and how they were handled
