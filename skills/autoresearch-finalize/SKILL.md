---
name: autoresearch-finalize
context: fork
description: Finalize an autoresearch session into clean, reviewable branches and archive its experiments and outcomes in the local knowledge base. Use when asked to "finalize autoresearch", "clean up experiments", or "prepare autoresearch for review".
---

# Finalize Autoresearch

Turn a noisy autoresearch branch into clean, independent branches — one per logical change, each starting from the merge-base.

## Step 1 — Analyze and Propose Groups

1. Read `autoresearch.jsonl`. Filter to **kept** experiments only.
2. Read `autoresearch.md` for context.
3. Expand all short commit hashes to full hashes: `git rev-parse <short_hash>`
4. Get the merge-base: `git merge-base HEAD main`
5. For each kept commit, get the diff stat (use `$BASE..<commit>` for the first, `<prev_kept>..<commit>` for subsequent).
6. Group kept commits into logical changesets:
   - **Preserve application order.** Group N comes before Group N+1.
   - **No two groups may touch the same file.** Each branch is applied to merge-base independently — overlapping files would conflict. If two groups touch the same file, merge them into one group.
   - **Watch for cross-file dependencies.** Each branch is independent, so if group 1 adds an API in `api.js` and group 2 calls it in `parser.js`, group 2's branch won't work in isolation. When proposing groups, flag dependencies: "group 2 depends on group 1 — review together." If the dependency is tight, merge the groups.
   - **Keep each group small and focused.** One idea, one theme per group.
   - **Don't hardcode a count.** Could be 2, could be 15.

Present the proposed grouping to the user:

```
Proposed branches (each from merge-base, independent):

1. **Switch test runner to forks pool** (commits abc1234, def5678)
   Files: vitest.config.ts, package.json
   Metric: 42.3s → 38.1s (-9.9%)

2. **Tune worker count and timeouts** (commits ghi9012, jkl3456)
   Files: test/setup.ts
   Metric: 38.1s → 31.7s (-16.8%)
```

**Wait for approval before proceeding.**

## Step 2 — Write groups.json and Run

Write `groups.json`:

```json
{
  "base": "<full merge-base hash>",
  "trunk": "main",
  "final_tree": "<full hash of current HEAD>",
  "goal": "short-slug",
  "groups": [
    {
      "title": "Switch to forks pool",
      "body": "Why + what changed.\n\nExperiments: #3, #5\nMetric: total_time 42.3s → 38.1s (-9.9%)",
      "last_commit": "<full hash of last kept commit in this group>",
      "slug": "forks-pool"
    }
  ]
}
```

Key rules:
- **`last_commit` must be a full hash.** Expand from jsonl short hashes with `git rev-parse`.
- **No two groups may share a file.** The script validates this and fails if violated.

Then run:

```bash
bash <SKILL_DIR>/finalize.sh /tmp/groups.json
```

The script creates one branch per group from the merge-base, verifies the union matches the original branch, and prints a summary with all branches, cleanup commands, and any ideas from `autoresearch.ideas.md`.

On creation failure: rolls back (deletes branches, restores original branch, pops stash).
On verification failure: exits non-zero but leaves branches intact for inspection.

## Step 3 — Archive the Session in `kb`

After branch creation and verification succeed, preserve the complete experiment record as a synthesized Markdown entry in the local knowledge base.

1. Activate the `knowledge-base` skill and read `~/.kit/prompts/archive.md`. Follow its rules for CLI availability, resolving the `Coding sessions` collection root, finding an existing entry, safe content, indexing, and search verification.
2. Search `Coding sessions` for the repository, autoresearch goal, date, and metric before choosing whether to create or update an entry.
3. Archive the autoresearch session as `YYYY-MM-DD-<project>-autoresearch-<goal>.md`, adding a distinguishing suffix only when that filename belongs to a different work thread.
4. Include concise frontmatter with `date`, `project`, absolute `repository`, `status: finalized`, and tags for `kit-session` and `autoresearch`.
5. Synthesize these sections from `autoresearch.md`, `autoresearch.jsonl`, `autoresearch.ideas.md`, `/tmp/groups.json`, and the finalize script output:
   - objective, primary metric, unit, and optimization direction;
   - baseline, best result, and overall percentage improvement;
   - an experiment table containing every logged run—not only kept runs—with run number, status, commit, primary metric, secondary metrics, and description;
   - grouped changes and the review branches created;
   - durable learnings from descriptions and ASI, including failed hypotheses when they prevent repeated work;
   - deferred ideas, validation performed, cleanup commands, and unresolved issues.
6. Do not copy raw JSONL wholesale. Preserve useful experiment evidence while omitting noisy operational fields, credentials, hidden reasoning, and irrelevant command output.
7. Run `kb update "Coding sessions"`, then verify the entry with a focused `kb search` query. If writing or indexing fails, keep the finalized branches intact, report the archive failure, and do not claim the session is available in the knowledge base.

## Step 4 — Report

After the script and archive workflow finish, report to the user:
- Branches created and what each contains
- Overall metric improvement (baseline → best)
- The archive's absolute path and `Coding sessions/<relative-path>` virtual path
- Whether `kb update` and focused search verification succeeded
- Show the cleanup commands from the script's summary output

## Edge Cases

- **Only 1 kept experiment**: One branch is fine — don't force splits.
- **Overlapping files between groups**: The script fails with an error naming the file. Merge the overlapping groups and retry.
- **Non-experiment commits** on the branch: Skip them — only process kept experiments from the jsonl.
