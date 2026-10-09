#!/usr/bin/env bash
# The lines a merge dropped (CLAUDE.md § Protecting existing work): after
# resolving a conflict, list each line one side added that the result lacks,
# and account for every one it prints.
#
#   scripts/merge-lost-lines.sh            # the merge in progress, else HEAD
#   scripts/merge-lost-lines.sh <commit>   # a merge commit
#
# With a merge in progress (MERGE_HEAD is set) the result is the working tree,
# as you resolved it, and the sides are HEAD and MERGE_HEAD; otherwise the
# result is the merge commit's tree and the sides are its two parents. For each
# file either side changed since their merge base, every line that side added
# (`git diff <base> <side>`) is looked for in the result's copy of the same
# file, as a whole line, and printed when it is missing, under the side's name.
# Blank lines are skipped. A line printed is not always a loss: a resolution
# may reword it on purpose. It is a line to read, not a verdict. A file the
# result deleted is named once per side, with the number of lines it added.
#
# Exit: 0 nothing missing; 1 lines printed; 2 a usage or git error (not a
# merge, a commit with one parent, no merge base).
set -euo pipefail

# Paths as they are, one per line (no octal quoting of non-ASCII names).
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotePath GIT_CONFIG_VALUE_0=false

usage() {
	echo "usage: scripts/merge-lost-lines.sh [<merge commit>]" >&2
	exit 2
}

case "${1:-}" in
	-h | --help)
		sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
esac
[ $# -le 1 ] || usage

root=$(git rev-parse --show-toplevel) || exit 2
cd "$root"

if [ $# -eq 0 ] && git rev-parse --verify --quiet MERGE_HEAD >/dev/null; then
	ours=$(git rev-parse HEAD)
	theirs=$(git rev-parse MERGE_HEAD)
	result=''
	echo "merge in progress: HEAD ${ours:0:8} + MERGE_HEAD ${theirs:0:8}, result = the working tree"
else
	commit=$(git rev-parse --verify --quiet "${1:-HEAD}^{commit}") || {
		echo "merge-lost-lines: no commit '${1:-HEAD}'" >&2
		exit 2
	}
	ours=$(git rev-parse --verify --quiet "$commit^1") || ours=''
	theirs=$(git rev-parse --verify --quiet "$commit^2") || {
		echo "merge-lost-lines: ${commit:0:8} is not a merge (it has one parent), and no merge is in progress" >&2
		exit 2
	}
	result=$commit
	echo "merge ${commit:0:8}: ${ours:0:8} + ${theirs:0:8}"
fi

base=$(git merge-base "$ours" "$theirs") || {
	echo "merge-lost-lines: ${ours:0:8} and ${theirs:0:8} have no merge base" >&2
	exit 2
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The result's copy of a file, into $tmp/result; false when the result has no such file.
result_file() {
	if [ -z "$result" ]; then
		[ -f "$1" ] || return 1
		cat -- "$1" >"$tmp/result"
	else
		[ "$(git cat-file -t "$result:$1" 2>/dev/null)" = blob ] || return 1
		git show "$result:$1" >"$tmp/result"
	fi
}

# The lines a side added to a file since the base, one per line, blank ones left out.
added() {
	git diff --no-color --no-ext-diff --no-renames -U0 "$base" "$1" -- "$2" |
		awk '/^@@/ { hunk = 1; next } /^diff --git/ { hunk = 0 } hunk && /^\+/ { line = substr($0, 2); if (line ~ /[^ \t]/) print line }'
}

# Only a file the result has differently from a side can lack a line that
# side added: a file the result took whole from it has them all.
differs() {
	if [ -z "$result" ]; then
		git diff --name-only --no-renames "$1" --
	else
		git diff --name-only --no-renames "$1" "$result" --
	fi
}

lost=0
for side in ours theirs; do
	if [ "$side" = ours ]; then sha=$ours; else sha=$theirs; fi
	git diff --name-only --no-renames "$base" "$sha" | LC_ALL=C sort >"$tmp/changed"
	differs "$sha" | LC_ALL=C sort >"$tmp/differs"
	LC_ALL=C comm -12 "$tmp/changed" "$tmp/differs" >"$tmp/files"
	while IFS= read -r file; do
		added "$sha" "$file" >"$tmp/added"
		[ -s "$tmp/added" ] || continue
		if ! result_file "$file"; then
			echo
			echo "$file: not in the result, and $side (${sha:0:8}) added $(wc -l <"$tmp/added" | tr -d ' ') line(s) to it"
			lost=1
			continue
		fi
		awk 'NR == FNR { have[$0] = 1; next } !($0 in have) && !seen[$0]++' "$tmp/result" "$tmp/added" >"$tmp/missing"
		if [ -s "$tmp/missing" ]; then
			echo
			echo "$file: added by $side (${sha:0:8}), missing from the result:"
			sed 's/^/  | /' "$tmp/missing"
			lost=1
		fi
	done <"$tmp/files"
done

if [ "$lost" -eq 0 ]; then
	echo "every line either side added is in the result"
fi
exit "$lost"
