# Shared by install.sh and uninstall.sh. Source after setting $repo.

usage() {
  echo "usage: $0 [--project DIR] <profile-or-entry> [profile-or-entry ...]" >&2
  echo "  profile:       a name from profiles/ (e.g. common)" >&2
  echo "  entry:         a repo path (e.g. skills/monologue, prompts/adr.md)" >&2
  echo "  --project DIR: use DIR's project config instead of \$KIT_HOME" >&2
  exit 2
}

# Parses options into $project and the remaining arguments into $args.
project=""
args=()
parse_args() {
  while (($# > 0)); do
    case $1 in
      --project)
        (($# >= 2)) || usage
        project=$2
        shift 2
        ;;
      --project=*)
        project=${1#--project=}
        shift
        ;;
      -h | --help) usage ;;
      -*)
        echo "unknown option: $1" >&2
        usage
        ;;
      *)
        args+=("${1%/}")
        shift
        ;;
    esac
  done

  ((${#args[@]} > 0)) || usage

  if [[ -n "$project" ]]; then
    if [[ ! -d "$project" ]]; then
      echo "project directory does not exist: $project" >&2
      exit 2
    fi
    project=$(cd "$project" && pwd)
  fi
}

# Prints the install location for a repo entry, or nothing when the entry's
# category is not supported at the selected scope.
target_for() {
  local entry=$1
  local category=${entry%%/*}

  if [[ -z "$project" ]]; then
    echo "${KIT_HOME:-"$HOME/.kit"}/$entry"
    return
  fi

  # Project discovery paths, per Kit's docs/features/*.md.
  case $category in
    skills | prompts) echo "$project/.agents/$entry" ;;
    agents | plugins) echo "$project/.kit/$entry" ;;
    themes) ;; # Themes are only loaded from $KIT_HOME/themes.
    *)
      echo "unsupported category: $entry" >&2
      return 1
      ;;
  esac
}

# Prints each entry named by the arguments, expanding profiles.
expand_entries() {
  local arg entry
  for arg in "${args[@]}"; do
    if [[ -f "$repo/profiles/$arg" ]]; then
      while IFS= read -r entry || [[ -n "$entry" ]]; do
        [[ -z "$entry" || "$entry" == \#* ]] && continue
        echo "$entry"
      done < "$repo/profiles/$arg"
    else
      echo "$arg"
    fi
  done
}

# Exits when an argument names neither a profile nor a repo entry.
validate_args() {
  local arg
  for arg in "${args[@]}"; do
    if [[ ! -f "$repo/profiles/$arg" && ! -e "$repo/$arg" ]]; then
      echo "unknown profile or entry: $arg" >&2
      exit 2
    fi
  done
}
