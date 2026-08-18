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

for arg in "$@"; do
  arg=${arg%/}
  profile_file="$repo/profiles/$arg"

  if [[ -f "$profile_file" ]]; then
    while IFS= read -r entry || [[ -n "$entry" ]]; do
      [[ -z "$entry" || "$entry" == \#* ]] && continue
      install_entry "$entry"
    done < "$profile_file"
  elif [[ -e "$repo/$arg" ]]; then
    install_entry "$arg"
  else
    echo "unknown profile or entry: $arg" >&2
    exit 2
  fi
done
