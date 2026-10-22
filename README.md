# dot-kit

Portable Kit configuration installed through entry-level symlinks.

## Install

```sh
./install.sh common
```

`install.sh` links each entry named by a profile into `~/.kit`. Arguments can
also be individual entry paths instead of profile names:

```sh
./install.sh skills/monologue prompts/adr.md
```

Category
directories such as `~/.kit/plugins` remain real directories, so local files
and machine-specific plugins can live beside the portable links.

The installer refuses to replace existing local files or foreign symlinks.
Set `KIT_HOME` to install into a non-default Kit directory.

### Project install

Pass `--project DIR` to link entries into a project's Kit config instead of
the global one:

```sh
./install.sh --project ~/code/app common
```

Entries go where Kit discovers them for a session in that project:

| Category | Global | Project |
|---|---|---|
| `skills/`, `prompts/` | `$KIT_HOME/<category>` | `DIR/.agents/<category>` |
| `agents/`, `plugins/` | `$KIT_HOME/<category>` | `DIR/.kit/<category>` |
| `themes/` | `$KIT_HOME/themes` | skipped (global only) |

For skills, prompts, and agents, global definitions win over project
definitions with the same name, so a project install does not override an
entry that is also installed globally. Avoid installing the same plugin at
both scopes.
The links are absolute paths into this repository; keep them out of the
project's version control unless every collaborator clones it to the same
location.

## Uninstall

Remove links installed by one or more profiles:

```sh
./uninstall.sh common
./uninstall.sh skills/monologue
./uninstall.sh --project ~/code/app common
```

Use the same `--project` or `KIT_HOME` that the entries were installed with.

The uninstaller removes only symlinks that point into this repository. It
leaves machine-local entries and foreign symlinks untouched.

## Profiles

Profiles under `profiles/` contain one repository-relative path per line. A
machine can combine profiles:

```sh
./install.sh common mac work
```

Removing an entry's symlink disables it only on that machine. Adding a normal
file or directory directly beneath `~/.kit/agents`, `plugins`, `prompts`,
`skills`, or `themes` keeps it machine-local.

## Intentionally excluded

Runtime state and secrets remain under `~/.kit` and are not managed here:

- `auth.json`
- `mcp-auth.json`
- `mcp-cache.json`
- `sessions/`
- `plugin-cache/`
- mutable machine-level JSON settings and notification state

Plugins may keep machine-local runtime files beside their source when those
files are covered by a plugin-local `.gitignore`. For example,
`plugins/tool-approval/config.json` records enabled project paths independently
for each clone and machine.
