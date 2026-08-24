---
description: Sync meeting notes into ~/Developer/meetings and refresh the kb meetings collection
---

Run the meeting notes sync workflow now.

1. Execute:
```bash
bun run ~/.kit/meeting-sync/sync.ts $ARGUMENTS
```

2. Report back with:
- whether sync succeeded
- number of notes synced (if available)
- any errors encountered
- where files were written (`~/Developer/meetings/`)

Notes:
- Default range syncs notes created this week.
- Pass `--range` to sync notes created in the last 30 days.
- Pass `--query "..."` to filter notes before syncing.
