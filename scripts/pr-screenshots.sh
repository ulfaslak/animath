#!/usr/bin/env bash
# Publishes screenshots for a PR body on the `screenshots` branch, in the
# folder named after the PR number, and prints the markdown that shows them.
#
#   scripts/pr-screenshots.sh <pr-number> <file.png>...
#
# It never checks the branch out: it builds the new commit with git's plumbing
# in a throwaway index, so the worktree, its index and its branch are left as
# they were. A push that loses a race with another agent's is rejected (no
# force), and the script fetches the new tip and builds on it again.
# AGENTS/DNA/DEVELOPMENT.md § Screenshots in PRs.
set -euo pipefail

die() {
  echo "pr-screenshots: $*" >&2
  exit 1
}

[ $# -ge 2 ] || die "usage: scripts/pr-screenshots.sh <pr-number> <file.png>..."
pr=$1
shift
[[ $pr =~ ^[0-9]+$ ]] || die "the first argument is the PR number, not '$pr'"
for f in "$@"; do
  [ -f "$f" ] || die "no file '$f'"
  name=$(basename "$f")
  # The name goes into a URL and a markdown link as it is.
  [[ $name =~ ^[A-Za-z0-9._-]+$ ]] || die "'$name': use only letters, digits, '.', '_' and '-'"
done

remote=${PR_SCREENSHOTS_REMOTE:-origin}
branch=screenshots
tracking=refs/remotes/$remote/$branch
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_INDEX_FILE=$tmp/index

pushed=
for attempt in 1 2 3 4 5 6; do
  git fetch -q "$remote" "+refs/heads/$branch:$tracking"
  parent=$(git rev-parse "$tracking^{commit}")
  rm -f "$GIT_INDEX_FILE"
  git read-tree "$parent"
  for f in "$@"; do
    blob=$(git hash-object -w -- "$f")
    git update-index --add --cacheinfo "100644,$blob,$pr/$(basename "$f")"
  done
  tree=$(git write-tree)
  if [ "$tree" = "$(git rev-parse "$parent^{tree}")" ]; then
    pushed=unchanged
    break
  fi
  commit=$(git commit-tree "$tree" -p "$parent" -m "Screenshots for #$pr")
  # Quoted and braced: in zsh, "$commit:r…" would read ':r' as a modifier.
  if git push -q "$remote" "${commit}:refs/heads/${branch}"; then
    pushed=yes
    break
  fi
  echo "pr-screenshots: the push lost a race (attempt $attempt), building on the new tip" >&2
  sleep "$attempt"
done
[ -n "$pushed" ] || die "could not push to $branch after 6 attempts"

for f in "$@"; do
  name=$(basename "$f")
  echo "![${name%.*}](https://github.com/ulfaslak/animath/blob/$branch/$pr/$name?raw=true)"
done
