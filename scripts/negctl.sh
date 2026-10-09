#!/usr/bin/env bash
# A negative control, done the safe way (CLAUDE.md § The test-fix-learn cycle,
# "Fix everything you find"): put back the code from before the fix, watch the
# test fail, and restore the fix from the last commit, whatever happens.
#
#   scripts/negctl.sh [--from <ref>] <path>... -- <test command>...
#
#   scripts/negctl.sh packages/client/src/save/autosave.ts -- \
#     pnpm -F @mathgame/client exec vitest run test/autosave.test.ts
#
# Paths are read from where you run it, and the test command runs there too.
# First the test runs as the code is, and must pass: a command that fails
# anyway (a typo, a missing test file) proves nothing. Then each <path> is
# written as it was at <ref> (default `HEAD~1`: the commit before the fix), the
# test runs again, and every path is written back from HEAD with
# `git show HEAD:<path>` and its mode, never `git checkout` (CLAUDE.md
# § Protecting existing work). It refuses to start while any <path> differs
# from HEAD, so nothing uncommitted can be lost: commit the fix first. A path
# the fix added (not at <ref>) is refused: deleting it would fail the test on a
# missing module, not on the bug. A run killed outright (SIGKILL) cannot
# restore: put the files back with the command it prints first.
#
# Exit: 0 the control holds (the test passed with the fix, failed without it);
# 1 the test passed without the fix (it does not catch what it claims);
# 2 a usage or git error, or a test that fails with the fix too or could not
# run (exit 126, 127, or a signal); 3 the restore did not match HEAD.
set -uo pipefail

from=HEAD~1
args=()
while [ $# -gt 0 ]; do
	case "$1" in
		--from)
			[ $# -ge 2 ] || { echo "negctl: --from needs a ref" >&2; exit 2; }
			from=$2
			shift 2
			;;
		--)
			shift
			break
			;;
		-h | --help)
			sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*)
			args+=("$1")
			shift
			;;
	esac
done

if [ ${#args[@]} -eq 0 ] || [ $# -eq 0 ]; then
	echo "usage: scripts/negctl.sh [--from <ref>] <path>... -- <test command>..." >&2
	exit 2
fi

root=$(git rev-parse --show-toplevel) || exit 2
prefix=$(git rev-parse --show-prefix) || exit 2
git rev-parse --verify --quiet "$from^{commit}" >/dev/null || {
	echo "negctl: no commit '$from'" >&2
	exit 2
}

# Each path from the repo's root, for git; the files themselves are reached through $root.
paths=()
for a in "${args[@]}"; do
	p=$(cd "$(dirname "$a")" 2>/dev/null && printf '%s%s' "$(git rev-parse --show-prefix)" "$(basename "$a")") || p="$prefix$a"
	p=${p#./}
	paths+=("$p")
done

for p in "${paths[@]}"; do
	if [ "$(git cat-file -t "HEAD:$p" 2>/dev/null)" != blob ]; then
		echo "negctl: $p is not a file in HEAD; commit the fix first" >&2
		exit 2
	fi
	if ! git -C "$root" diff --quiet HEAD -- "$p" || [ ! -e "$root/$p" ]; then
		echo "negctl: $p has uncommitted changes; commit them first, so the restore cannot lose them" >&2
		exit 2
	fi
	if [ "$(git cat-file -t "$from:$p" 2>/dev/null)" != blob ]; then
		echo "negctl: $p is not a file at $from: the fix added it, and deleting it would fail the test on its absence, not on the bug. Break the code that uses it instead." >&2
		exit 2
	fi
done

if git -C "$root" diff --quiet "$from" HEAD -- "${paths[@]}"; then
	echo "negctl: every path is the same at $from as at HEAD: nothing to break (is --from right?)" >&2
	exit 2
fi

ran() {
	local status=$1
	if [ "$status" -eq 126 ] || [ "$status" -eq 127 ] || [ "$status" -ge 128 ]; then
		echo "negctl: the test command could not run, or was stopped (exit $status)" >&2
		return 1
	fi
	return 0
}

echo "negctl: with the fix: $*"
"$@"
status=$?
if [ "$status" -ne 0 ]; then
	ran "$status" || exit 2
	echo "negctl: the test fails with the fix in place too (exit $status): a failure without it would prove nothing" >&2
	exit 2
fi

echo "negctl: if this run is killed, restore with: git -C '$root' show HEAD:<path> > <path> for ${paths[*]}"

restored=0
restore() {
	[ "$restored" -eq 1 ] && return
	restored=1
	local ok=1
	for p in "${paths[@]}"; do
		git show "HEAD:$p" >"$root/$p" || ok=0
		case "$(git ls-tree HEAD -- "$p" | cut -d' ' -f1)" in
			100755) chmod +x "$root/$p" ;;
			*) chmod -x "$root/$p" ;;
		esac
	done
	if [ "$ok" -eq 1 ] && git -C "$root" diff --quiet HEAD -- "${paths[@]}"; then
		echo "negctl: restored ${#paths[@]} file(s) from HEAD"
		return 0
	fi
	echo "negctl: RESTORE DID NOT MATCH HEAD for: ${paths[*]}" >&2
	return 1
}
on_exit() {
	local status=$?
	restore || exit 3
	exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

for p in "${paths[@]}"; do
	git show "$from:$p" >"$root/$p" || { echo "negctl: could not write $p as at $from" >&2; exit 2; }
done

echo "negctl: without the fix (${paths[*]} as at $(git rev-parse --short "$from")): $*"
"$@"
status=$?
ran "$status" || exit 2
if [ "$status" -eq 0 ]; then
	echo "negctl: THE TEST PASSED WITHOUT THE FIX. It does not catch what it claims." >&2
	exit 1
fi
echo "negctl: the control holds: without the fix the test failed (exit $status)."
exit 0
