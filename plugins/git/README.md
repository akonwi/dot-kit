# CI status

Adds a non-clickable, bottom-right CI summary for the current branch's pull request.
Kit keeps ownership of the cwd, branch, dirty marker, PR number, and PR link.
The plugin does not hide or replace Kit's built-in footer.

Requires Bun, Git, and an authenticated GitHub CLI (`gh`). Refreshes on project/Git
changes and every 60 seconds. Shows check counts and pass/fail/pending/canceled/
skipped status. No PR, unavailable check data, or a detached/non-Git directory
clears the CI item; an empty check list displays `CI none`.

The installation directory and plugin ID remain `git` to preserve existing links.
Reload Kit after updating the plugin.

Offline protocol tests (fake Git/GitHub commands; no network):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s plugins/git -v
```
