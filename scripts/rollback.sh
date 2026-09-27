#!/bin/bash
# Roll prod back to the build of an earlier commit, in one command:
#
#   pnpm rollback <sha>     # put the image built from <sha> back on prod
#   pnpm rollback           # list the recent deploys, to pick a SHA from
#
# It dispatches the Deploy workflow (.github/workflows/deploy.yml) with that
# SHA. No new build and no tests (the image passed them when it was built):
# the workflow points ghcr.io/ulfaslak/mathgame:prod at the image built from
# that commit, checks the server out at the same commit, so nginx and compose
# go back with it, and runs scripts/deploy.sh, the canary swap every deploy
# uses, then checks /api/health reports that commit.
#
# It holds until the next push to main, which deploys main again: to stay on
# the old build, merge a revert. Migrations never go back, so the older build
# runs on the newer schema (why every migration keeps the build before it
# working: AGENTS/DNA/DEVELOPMENT.md § Migrations).
#
# Lawcel has no rollback. This has the shape of its `pnpm promote`: a script
# that dispatches a workflow, which retags an image and deploys it.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v gh >/dev/null || {
	echo "ERROR: gh CLI not found." >&2
	exit 1
}
# `pnpm rollback -- <sha>` forwards the separator itself.
[ "${1:-}" = "--" ] && shift

if [ $# -eq 0 ]; then
	echo "Recent deploys, newest first: the commit each one put on prod."
	# Only a run whose `deploy` job succeeded put an image on prod: a run with
	# [skip deploy], or without the deploy secrets, is green with it skipped.
	gh run list --workflow=deploy.yml --limit=20 \
		--json databaseId,headSha,createdAt,displayTitle \
		--jq '.[] | [.databaseId, .headSha, .createdAt, .displayTitle] | @tsv' |
		while IFS=$'\t' read -r run sha created title; do
			deployed=$(gh run view "$run" --json jobs \
				--jq '[.jobs[] | select(.name == "deploy") | .conclusion] | first' 2>/dev/null || echo "")
			[ "$deployed" = "success" ] || continue
			# A rollback run's head is main's tip; the commit it deployed is in its name.
			case "$title" in "Roll back to "*) sha="${title#Roll back to }" ;; esac
			printf '%s  %s  %s\n' "$sha" "${created%T*}" "$title"
		done
	echo
	echo "Roll back with: pnpm rollback <sha>"
	exit 0
fi

git fetch --quiet origin main
SHA=$(git rev-parse --verify --quiet "${1}^{commit}" || true)
if ! [[ "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
	echo "ERROR: '$1' is not a commit this checkout knows." >&2
	exit 2
fi
if ! git merge-base --is-ancestor "$SHA" origin/main; then
	echo "ERROR: $SHA is not on main: only a commit main deployed has an image." >&2
	exit 2
fi

echo "==> Rolling prod back to ${SHA:0:12}: $(git log -1 --format=%s "$SHA")"
gh workflow run deploy.yml --ref main -f rollback_sha="$SHA"
echo "    Dispatched. Watch it with: gh run watch"
