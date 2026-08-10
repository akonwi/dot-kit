#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
kit_root=${KIT_HOME:-"$HOME/.kit"}

if (($# == 0)); then
  echo "usage: $0 <profile> [profile ...]" >&2
  exit 2
fi

install_entry() {
  local entry=$1
  local source="$repo/$entry"
  local target="$kit_root/$entry"

  if [[ ! -e "$source" ]]; then
    echo "missing source: $entry" >&2
    return 1
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

for profile in "$@"; do
  profile_file="$repo/profiles/$profile"
  if [[ ! -f "$profile_file" ]]; then
    echo "unknown profile: $profile" >&2
    exit 2
  fi

  while IFS= read -r entry || [[ -n "$entry" ]]; do
    [[ -z "$entry" || "$entry" == \#* ]] && continue
    install_entry "$entry"
  done < "$profile_file"
done
