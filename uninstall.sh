#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$repo/lib.sh"

parse_args "$@"
validate_args

uninstall_entry() {
  local entry=$1
  local source="$repo/$entry"
  local target

  target=$(target_for "$entry")
  if [[ -z "$target" ]]; then
    echo "skipped $entry (global only)"
    return
  fi

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

while IFS= read -r entry; do
  uninstall_entry "$entry"
done < <(expand_entries)
