# dot-kit

Portable Kit configuration. See README.md for layout, profiles, and the
symlink installer.

## Keep installed copies in sync after pulling

Installed entries may be `install.sh` symlinks, which always show HEAD, or
independent copies, which go stale. Whenever you bring remote commits into
`main` (`git pull`, a fetch and merge, or a rebase onto `origin/main`):

1. Record HEAD before pulling: `old=$(git rev-parse HEAD)`.
2. After pulling, run `./sync-installed.sh --since "$old"` and read the report.
3. Run `./sync-installed.sh --apply`. It updates only copies that exactly match an earlier repo version, so local edits are never overwritten, and it never touches gitignored runtime files such as plugin `state/`, `config.json`, or `node_modules`. Do this without asking; it's the point of pulling.
4. Report to the user, and don't act on these without asking:
   - `modified`: the installed copy has local edits. Show the diff and ask whether to push the local version to the repo or take the repo's.
   - `removed`: the repo deleted an entry that's still installed. Ask before deleting the local copy.
   - `new`: the repo added an entry that isn't installed. Ask before installing it.
   - Plugins whose dependencies changed: ask before installing them.
5. Tell the user that open sessions keep the old version until they run **reload** from the command palette. Don't reload sessions yourself.

The script reads `KIT_HOME` (default `~/.kit`). Don't run it against a
project's `.kit` or `.agents` directories.

## Testing changes to sync-installed.sh

Point `KIT_HOME` at a temporary directory you create, filled with entries
from `git archive <rev> <entry>`, and remove only that directory afterwards.
Never test `--apply` against the real Kit home.
