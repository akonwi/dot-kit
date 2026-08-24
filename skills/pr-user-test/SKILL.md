---
name: pr-user-test
description: Check out a Cartwheel GitHub pull request into an isolated worktree, read its description and manual test plan, start the local app, prepare test data, delegate end-user validation to the user-tester, collect evidence, and clean up when requested. Use when the user asks to test, review, QA, or try a Cartwheel PR, gives a Cartwheel PR number/URL for testing, or says to check out a PR as a worktree and user-test it.
---

# Cartwheel PR user-testing workflow

Use this workflow for repeatable end-user testing of pull requests in `cartwheel-care/cartwheel`.

## Inputs

Accept either:

- a PR number, such as `5436`
- a GitHub PR URL

Extract the numeric PR number as `PR_NUMBER`. If no PR is provided, ask for it. Do not guess.

## Fixed locations

```bash
CARTWHEEL_DIR="$HOME/Developer/cartwheel"
MAIN_DIR="$CARTWHEEL_DIR/main"
MANAGER="$CARTWHEEL_DIR/worktree-manage"
```

## 1. Inspect the PR before checkout

From the main checkout, read the PR metadata and full description:

```bash
cd "$MAIN_DIR"
gh pr view "$PR_NUMBER" --json title,body,url,author,headRefName,baseRefName,files
```

Identify:

- the intended user-facing behavior
- the manual test instructions
- the expected user role/account
- data prerequisites
- affected UI surfaces

If the PR has no usable manual test instructions, infer a focused flow from the description and diff, but clearly state what was inferred.

## 2. Create the isolated PR worktree

Use the user-managed worktree script rather than manually assembling a worktree:

```bash
"$MANAGER" checkout --pr "$PR_NUMBER"
```

Capture the final `Path:` and `Branch:` values from the output. Change the Kit session cwd to the reported worktree path with `change_cwd` when available. Because some shell tool calls may retain an older cwd, use an explicit `cd "$WORKTREE_PATH" && ...` in important commands.

If a worktree or branch already exists:

1. Run `"$MANAGER" list`.
2. Reuse the matching worktree if it is the same PR branch and is healthy.
3. Do not delete or overwrite an unrelated directory or worktree.

## 3. Load project guidance

Before engineering-related setup or investigation, read completely:

- `AGENTS.md`
- `handbook/docs/explanation/architecture-guidelines.md`
- `handbook/docs/explanation/architecture-next-phase.md`
- any task-relevant project skill or styleguide required by `AGENTS.md`

Do not modify source code during user testing unless the user explicitly asks for a fix.

## 4. Verify and start the isolated app

From the PR worktree:

```bash
bin/worktree status
```

Use the Rails URL reported by that command. Check whether it is already available. If it is not running, start it in the background and log output outside the repository:

```bash
nohup bin/dev > "/tmp/cartwheel-pr-${PR_NUMBER}-bin-dev.log" 2>&1 &
```

Wait until the Rails URL returns an HTTP response before testing. Keep the app running after the report unless the user asks to stop or clean up.

Do not run migrations, builds, or broad automated test suites merely to perform exploratory testing unless:

- the PR instructions explicitly require them,
- repository setup requires them and the user has authorized it, or
- the user asks for them.

If a missing frontend build blocks a deep link, report it as an environment blocker and ask before building. Retry when the user says the environment is ready.

## 5. Prepare local test data

Follow the PR's manual test instructions against the isolated worktree database only.

Guidelines:

- Prefer the exact Rails console/runner setup supplied by the PR author.
- Use `bundle exec rails runner -` for multiline Ruby from stdin.
- Select test records that match the required organization and role; do not blindly use `Client.first` if that creates data invisible to the test user.
- Print and retain the key IDs, organization, client name, account, and target URL needed by the tester.
- Local convenience-login buttons are acceptable when seeded passwords do not work.
- Never touch production or shared remote data.
- Do not persist helper scripts in the repository unless asked.

If the author's setup partially succeeds before an error, inspect existing records before rerunning to avoid unnecessary duplicates.

## 6. Delegate to the user tester

Activate the global `user-tester` skill when needed, then run the named `user-tester` sub-agent. Give it a complete test brief containing:

- PR number and title
- local Rails URL
- expected role/account and login method
- prepared record names and IDs
- exact flow and acceptance criteria from the PR
- expected deep-link destination
- instruction to check meaningful console/network errors
- screenshot directory: `~/screenshots/pr-${PR_NUMBER}`
- instruction not to modify source or run builds

Ask the tester to capture:

1. login/start state
2. target item or entry point
3. key modal/form state
4. final destination or outcome
5. any blocker/error state

For links opening a new tab, verify `href`, `target`, and `rel`, then test the destination itself.

## 7. Triage blockers and retry

Classify findings accurately:

- **PR behavior failure**: acceptance criteria are not met.
- **Local environment blocker**: missing build artifact, server unavailable, stale assets, or local auth issue.
- **Partial pass**: source behavior is visible but an environment issue blocks completion.

Do not label a local setup failure as a PR defect without evidence. If the user resolves a blocker and asks to retry, continue the existing user-tester conversation so it retains context and save new evidence with the next numeric filename prefix.

## 8. Report

Use this concise structure:

- **PR / flow tested**
- **Result**: pass, fail, or partial
- **What passed**
- **Findings / blockers**, with severity and repro steps
- **Evidence**, with absolute screenshot paths
- **Environment status**, including whether `bin/dev` remains running

Keep source-code review observations separate from end-user test results.

## 9. Cleanup only when requested

Do not automatically remove the worktree after testing. Wait for explicit confirmation that the user is done reviewing.

When cleanup is requested:

1. Stop the `bin/dev` process for this worktree cleanly when possible.
2. Return to `$CARTWHEEL_DIR` or `$MAIN_DIR`; do not remove the current shell's working directory while inside it.
3. Preview cleanup:

```bash
"$MANAGER" remove --dry "$WORKTREE_NAME"
```

4. If the preview matches the tested worktree, remove it:

```bash
"$MANAGER" remove "$WORKTREE_NAME"
```

The manager tears down the isolated database and Redis state, removes the worktree, and deletes the throwaway local PR branch. Preserve screenshots in `~/screenshots/pr-${PR_NUMBER}`.
