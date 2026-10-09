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
# Each <path> is written as it was at <ref> (default `HEAD~1`: the commit before
# the fix; a path that did not exist there is removed), the test command runs,
# and every path is written back from HEAD with `git show HEAD:<path>`, never
# `git checkout` (CLAUDE.md § Protecting existing work). It refuses to start
# while any <path> differs from HEAD, so nothing uncommitted can be lost: commit
# the fix first. Exits 0 when the test failed without the fix (the control
# holds), 1 when it passed (the test does not catch what it claims), 2 on a
# usage or git error.
set -euo pipefail

from=HEAD~1
paths=()
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
			sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*)
			paths+=("$1")
			shift
			;;
	esac
done

if [ ${#paths[@]} -eq 0 ] || [ $# -eq 0 ]; then
	echo "usage: scripts/negctl.sh [--from <ref>] <path>... -- <test command>..." >&2
	exit 2
fi

root=$(git rev-parse --show-toplevel)
cd "$root"
git rev-parse --verify --quiet "$from^{commit}" >/dev/null || {
	echo "negctl: no commit '$from'" >&2
	exit 2
}

for p in "${paths[@]}"; do
	if ! git cat-file -e "HEAD:$p" 2>/dev/null; then
		echo "negctl: $p is not in HEAD; commit the fix first" >&2
		exit 2
	fi
	if ! git diff --quiet HEAD -- "$p"; then
		echo "negctl: $p has uncommitted changes; commit them first, so the restore cannot lose them" >&2
		exit 2
	fi
done

restore() {
	for p in "${paths[@]}"; do
		mkdir -p "$(dirname "$p")"
		git show "HEAD:$p" >"$p"
	done
	if git diff --quiet HEAD -- "${paths[@]}"; then
		echo "negctl: restored ${#paths[@]} file(s) from HEAD"
	else
		echo "negctl: RESTORE DID NOT MATCH HEAD for: ${paths[*]}" >&2
	fi
}
trap restore EXIT

same=0
for p in "${paths[@]}"; do
	if git cat-file -e "$from:$p" 2>/dev/null; then
		git show "$from:$p" >"$p"
	else
		rm -f "$p"
	fi
	git diff --quiet HEAD -- "$p" && same=$((same + 1))
done
if [ "$same" -eq ${#paths[@]} ]; then
	echo "negctl: every path is the same at $from as at HEAD: nothing to break (is --from right?)" >&2
	exit 2
fi

echo "negctl: ${paths[*]} as at $(git rev-parse --short "$from"); running: $*"
set +e
"$@"
status=$?
set -e

if [ "$status" -eq 0 ]; then
	echo "negctl: THE TEST PASSED WITHOUT THE FIX. It does not catch what it claims." >&2
	exit 1
fi
echo "negctl: the control holds: without the fix the test failed (exit $status)."
exit 0
