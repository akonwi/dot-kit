#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
kit_root=${KIT_HOME:-"$HOME/.kit"}

if (($# == 0)); then
  echo "usage: $0 <profile> [profile ...]" >&2
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

for profile in "$@"; do
  profile_file="$repo/profiles/$profile"
  if [[ ! -f "$profile_file" ]]; then
    echo "unknown profile: $profile" >&2
    exit 2
  fi

done

for profile in "$@"; do
  profile_file="$repo/profiles/$profile"
  while IFS= read -r entry || [[ -n "$entry" ]]; do
    [[ -z "$entry" || "$entry" == \#* ]] && continue
    uninstall_entry "$entry"
  done < "$profile_file"
done
