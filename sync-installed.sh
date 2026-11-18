#!/usr/bin/env bash
# Brings entries installed as copies (rather than install.sh symlinks) up to
# date with this repository's HEAD. Reports by default; --apply updates.
#
# An installed copy is updated only when it exactly matches a version of the
# entry this repository once had, so local edits are never overwritten.
# Files the repository's .gitignore rules cover (plugin runtime state,
# config.json, node_modules, .DS_Store) are neither compared nor touched.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
kit_home=${KIT_HOME:-"$HOME/.kit"}
categories="agents plugins prompts skills themes"
apply=false
since=""

usage() {
  echo "usage: $0 [--apply] [--since REV]" >&2
  echo "  --apply      update outdated copies (default: report only)" >&2
  echo "  --since REV  also list entries added since REV that aren't installed" >&2
  exit 2
}

while (($# > 0)); do
  case $1 in
    --apply) apply=true; shift ;;
    --since) (($# >= 2)) || usage; since=$2; shift 2 ;;
    --since=*) since=${1#--since=}; shift ;;
    *) usage ;;
  esac
done

g() { git -C "$repo" "$@"; }
[[ -z $since ]] || g rev-parse -q --verify "$since^{commit}" >/dev/null || { echo "unknown revision: $since" >&2; exit 2; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/sync-installed.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT

# Prints "<rel>\t<blob>" for each file of an entry at a commit, sorted.
# A single-file entry has an empty <rel>. Submodules are left out.
repo_sig() {
  local commit=$1 entry=$2 line meta path mode type hash rel
  g ls-tree -r "$commit" -- "$entry" | while IFS= read -r line; do
    meta=${line%%$'\t'*}
    path=${line#*$'\t'}
    read -r mode type hash <<<"$meta"
    [[ $type == blob ]] || continue
    rel=${path#"$entry"}
    rel=${rel#/}
    printf '%s\t%s\n' "$rel" "$hash"
  done | LC_ALL=C sort
}

# Prints the same signature for an installed copy, leaving out ignored files.
installed_sig() {
  local entry=$1 target=$2
  if [[ -f $target ]]; then
    printf '\t%s\n' "$(g hash-object -- "$target")"
    return
  fi
  (cd "$target" && find . -type f | sed 's#^\./##' | LC_ALL=C sort) >"$tmp/files"
  sed "s#^#$entry/#" "$tmp/files" | g check-ignore --no-index --stdin >"$tmp/ignored" || true
  sed "s#^$entry/##" "$tmp/ignored" | LC_ALL=C sort >"$tmp/ignored.rel"
  LC_ALL=C comm -23 "$tmp/files" "$tmp/ignored.rel" >"$tmp/kept"
  [[ -s $tmp/kept ]] || return 0
  sed "s#^#$target/#" "$tmp/kept" | g hash-object --stdin-paths >"$tmp/hashes"
  paste "$tmp/kept" "$tmp/hashes"
}

# Prints the commit whose version of entry the installed copy matches.
matching_commit() {
  local entry=$1 sig=$2 commit
  for commit in $(g rev-list HEAD -- "$entry"); do
    if [[ $(repo_sig "$commit" "$entry") == "$sig" ]]; then
      echo "$commit"
      return
    fi
  done
}

# Overwrites an installed copy that matches old with HEAD's version. Writes
# plugin.json last, so a plugin's manifest never points at missing code.
update_entry() {
  local entry=$1 target=$2 old=$3 line meta path mode type hash rel dest
  if [[ -f $target ]]; then
    hash=$(g rev-parse "HEAD:$entry")
    g cat-file blob "$hash" >"$target.sync-tmp" && mv -f "$target.sync-tmp" "$target"
    return
  fi
  g ls-tree -r HEAD -- "$entry" | LC_ALL=C sort -t $'\t' -k2,2 |
    awk -F'\t' '{ if ($2 ~ /\/plugin\.json$/) last = $0; else print } END { if (last) print last }' |
    while IFS= read -r line; do
      meta=${line%%$'\t'*}
      path=${line#*$'\t'}
      read -r mode type hash <<<"$meta"
      [[ $type == blob ]] || continue
      rel=${path#"$entry"/}
      dest=$target/$rel
      mkdir -p "$(dirname "$dest")"
      g cat-file blob "$hash" >"$dest.sync-tmp"
      if [[ $mode == 100755 ]]; then chmod 755 "$dest.sync-tmp"; else chmod 644 "$dest.sync-tmp"; fi
      mv -f "$dest.sync-tmp" "$dest"
    done
  # Files the old version had and HEAD doesn't. They matched the old version
  # exactly, so removing them loses nothing.
  LC_ALL=C comm -23 <(repo_sig "$old" "$entry" | cut -f1) <(repo_sig HEAD "$entry" | cut -f1) |
    while IFS= read -r rel; do
      [[ -n $rel && $rel != *..* ]] && rm -f -- "$target/$rel"
    done
}

changed_deps() {
  local entry=$1 old=$2 file
  for file in package.json bun.lock package-lock.json; do
    if [[ $(g rev-parse -q --verify "$old:$entry/$file" 2>/dev/null) != $(g rev-parse -q --verify "HEAD:$entry/$file" 2>/dev/null) ]]; then
      echo " (dependencies changed: install them before reloading)"
      return
    fi
  done
}

current=0
report() { printf '%-17s %s%s\n' "$1" "$2" "${3:-}"; }

for category in $categories; do
  # Entries in the repository at HEAD.
  for entry in $(g ls-tree --name-only HEAD "$category/" 2>/dev/null); do
    [[ $(basename "$entry") == .* ]] && continue
    target=$kit_home/$entry
    if [[ $(g ls-tree HEAD -- "$entry" | cut -d' ' -f2) == commit ]]; then
      [[ -e $target ]] && report submodule "$entry" " (not compared)"
      continue
    fi
    if [[ -L $target ]]; then
      continue # install.sh manages links; they always show HEAD.
    fi
    if [[ ! -e $target ]]; then
      if [[ -n $since ]] && ! g cat-file -e "$since:$entry" 2>/dev/null; then
        report new "$entry" " (added since ${since:0:7}; not installed)"
      fi
      continue
    fi
    sig=$(installed_sig "$entry" "$target")
    if [[ $sig == "$(repo_sig HEAD "$entry")" ]]; then
      current=$((current + 1))
      continue
    fi
    old=$(matching_commit "$entry" "$sig")
    if [[ -z $old ]]; then
      report modified "$entry" " (local edits; compare with: diff -ru $repo/$entry $target)"
    elif $apply; then
      update_entry "$entry" "$target" "$old"
      report updated "$entry" " (was ${old:0:7})$(changed_deps "$entry" "$old")"
    else
      report outdated "$entry" " (matches ${old:0:7})$(changed_deps "$entry" "$old")"
    fi
  done

  # Installed copies of entries the repository has since removed.
  [[ -d $kit_home/$category ]] || continue
  for target in "$kit_home/$category"/*; do
    [[ -e $target && ! -L $target ]] || continue
    entry=$category/$(basename "$target")
    g cat-file -e "HEAD:$entry" 2>/dev/null && continue
    [[ -n $(g rev-list -1 HEAD -- "$entry") ]] || continue # never in the repo
    if [[ -n $(matching_commit "$entry" "$(installed_sig "$entry" "$target")") ]]; then
      report removed "$entry" " (deleted from the repo; installed copy unmodified)"
    else
      report removed "$entry" " (deleted from the repo; installed copy has local edits)"
    fi
  done
done

echo "$current installed copies already match HEAD ($(g rev-parse --short HEAD))."
