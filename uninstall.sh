#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
kit_root=${KIT_HOME:-"$HOME/.kit"}

if (($# == 0)); then
  echo "usage: $0 <profile-or-entry> [profile-or-entry ...]" >&2
  echo "  profile: a name from profiles/ (e.g. common)" >&2
  echo "  entry:   a repo path (e.g. skills/monologue, prompts/adr.md)" >&2
  exit 2
fi

uninstall_entry() {
  local entry=$1
  local source="$repo/$entry"
  local target="$kit_root/$entry"

  if [[ ! -L "$target" ]]; then
    if [[ -e "$target" ]]; then
      echo "kept    $entry (local entry)"
    else
      echo "absent  $entry"
    fi
    return
  fi

  if [[ "$(readlink "$target")" != "$source" ]]; then
    echo "kept    $entry (foreign symlink)"
    return
  fi

  rm "$target"
  echo "removed $entry"
}

# Validate all args up front.
for arg in "$@"; do
  arg=${arg%/}
  if [[ ! -f "$repo/profiles/$arg" && ! -e "$repo/$arg" ]]; then
    echo "unknown profile or entry: $arg" >&2
    exit 2
  fi
done

for arg in "$@"; do
  arg=${arg%/}
  profile_file="$repo/profiles/$arg"

  if [[ -f "$profile_file" ]]; then
    while IFS= read -r entry || [[ -n "$entry" ]]; do
      [[ -z "$entry" || "$entry" == \#* ]] && continue
      uninstall_entry "$entry"
    done < "$profile_file"
  else
    uninstall_entry "$arg"
  fi
done
