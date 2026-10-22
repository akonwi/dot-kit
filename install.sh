#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$repo/lib.sh"

parse_args "$@"
validate_args

install_entry() {
  local entry=$1
  local source="$repo/$entry"
  local target

  if [[ ! -e "$source" ]]; then
    echo "missing source: $entry" >&2
    return 1
  fi

  target=$(target_for "$entry")
  if [[ -z "$target" ]]; then
    echo "skipped $entry (global only)"
    return
  fi

  mkdir -p "$(dirname "$target")"

  if [[ -L "$target" ]]; then
    if [[ "$(readlink "$target")" == "$source" ]]; then
      echo "ok      $entry"
      return
    fi
    echo "refusing to replace foreign symlink: $target" >&2
    return 1
  fi

  if [[ -e "$target" ]]; then
    echo "refusing to replace local entry: $target" >&2
    return 1
  fi

  ln -s "$source" "$target"
  echo "linked  $entry"
}

while IFS= read -r entry; do
  install_entry "$entry"
done < <(expand_entries)
