#!/bin/bash
# Pull production backups + disaster-recovery credentials from the prod server
# to this Mac, then verify that what landed is actually restorable.
#
# This is the ONLY offsite copy of two things:
#   * the production database dumps (scripts/backup.sh, every 6 h on the server)
#   * ~/mathgame/.env.production — hand-edited on the server, stored nowhere
#     else. The /redeploy runbook reads it from ~/mathgame-backups/.env.production.
#
# Lawcel's scripts/sync-backups.sh, with the names changed (its comments below
# are its incidents), without the registry login (mathgame's server keeps none:
# the deploy workflow logs in with its own token for each deploy).
#
# Scheduled by the launchd agent com.mathgame.backup-sync — install it with
# scripts/install-backup-sync.sh, once the prod server exists. Alerts go to
# Slack on failure when ~/.config/mathgame/monitoring.env sets
# MONITORING_SLACK_WEBHOOK_URL; without it an alert is only a log line.
#
# Run manually: ./scripts/sync-backups.sh

set -euo pipefail

# The server is the game's domain (deploy.env). The installed copy gets it from
# the agent's environment (the installer reads deploy.env); run from the repo,
# it reads deploy.env itself.
if [ -z "${MATHGAME_DOMAIN:-}" ]; then
  DEPLOY_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy.env"
  # shellcheck source=/dev/null
  [ -f "$DEPLOY_ENV" ] && . "$DEPLOY_ENV"
fi
VPS_HOST="${MATHGAME_DOMAIN:?MATHGAME_DOMAIN is empty: set it in deploy.env}"
VPS_USER="deploy"
SSH_KEY="$HOME/.ssh/mathgame_deploy"
# The ~ is the server's: it expands there, in ssh's and rsync's remote paths.
# shellcheck disable=SC2088
REMOTE_PATH="~/mathgame/backups/"
LOCAL_PATH="$HOME/mathgame-backups/"

# Alert if the newest dump is older than this. The server dumps every 6h, so
# 30h tolerates a missed cycle plus a slow deploy without crying wolf, while
# still catching "the job silently stopped".
MAX_DUMP_AGE_HOURS="${MAX_DUMP_AGE_HOURS:-30}"

# Webhook lives outside the repo, and is optional.
MONITORING_ENV="$HOME/.config/mathgame/monitoring.env"
# shellcheck source=/dev/null
[ -f "$MONITORING_ENV" ] && . "$MONITORING_ENV"

PROBLEMS=()

note_problem() {
  PROBLEMS+=("$1")
  echo "PROBLEM: $1" >&2
}

send_alert() {
  local msg="$1"
  echo "ALERT: $msg" >&2

  if [ -z "${MONITORING_SLACK_WEBHOOK_URL:-}" ]; then
    echo "  (MONITORING_SLACK_WEBHOOK_URL unset in $MONITORING_ENV — alert not delivered)" >&2
    return 0
  fi

  local escaped payload
  escaped=$(printf '%s' "$msg" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  payload=$(printf '{"text":":rotating_light: *mathgame offsite backup sync* — %s"}' "$escaped")
  curl -sS --max-time 15 -X POST -H 'Content-Type: application/json' \
    --data "$payload" "$MONITORING_SLACK_WEBHOOK_URL" >/dev/null 2>&1 \
    || echo "  (Slack POST failed)" >&2
}

# Any unexpected non-zero exit (SSH down, disk full, rsync error) alerts too —
# otherwise the failure mode that hid for four months just moves one level up.
on_error() {
  send_alert "sync script FAILED at line $1 (exit $2). Offsite copy may be stale."
}
trap 'on_error "$LINENO" "$?"' ERR

mkdir -p "$LOCAL_PATH"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"

# ---------------------------------------------------------------------------
# 1. Database dumps.
#
#    `--delete` mirrors the server's retention window, which also means it
#    faithfully mirrors a server that has NO dumps — wiping the only offsite
#    copy we have. /redeploy provisions a fresh server whose ~/mathgame/backups/
#    is empty until a dump is copied *up*, and VPS_HOST is a DNS name that
#    follows to the new box. With RunAtLoad the agent can fire minutes later,
#    delete every local dump, and only then report "no dumps found" —
#    destroying the very file the recovery was about to restore from. So:
#    count the remote side first, and never let it delete what it cannot
#    replace.
# ---------------------------------------------------------------------------
# shellcheck disable=SC2086
remote_dumps=$($SSH_CMD "${VPS_USER}@${VPS_HOST}" \
  "ls ${REMOTE_PATH}*.dump 2>/dev/null | wc -l" 2>/dev/null || echo "ERR")
# find, not ls: with no local dumps yet (a fresh machine) `ls *.dump` exits 2 and
# pipefail + the ERR trap abort the very first sync before it copies anything.
local_dumps=$(find "$LOCAL_PATH" -maxdepth 1 -name '*.dump' | wc -l | tr -d ' ')

delete_flag="--delete"
if [ "$remote_dumps" = "ERR" ]; then
  note_problem "Could not count dumps on the server; syncing WITHOUT --delete to protect the offsite copy."
  delete_flag=""
else
  remote_dumps=$(printf '%s' "$remote_dumps" | tr -d ' ')
  if [ "$remote_dumps" -eq 0 ] && [ "$local_dumps" -gt 0 ]; then
    note_problem "The server has ZERO dumps but we hold ${local_dumps} locally. Refusing to mirror — this would erase the only offsite copy. Check the server's backup service."
    delete_flag=""
  elif [ "$local_dumps" -gt 5 ] && [ "$remote_dumps" -lt $((local_dumps / 2)) ]; then
    note_problem "The server has only ${remote_dumps} dumps vs ${local_dumps} local. Syncing WITHOUT --delete; investigate before trusting the server side."
    delete_flag=""
  fi
fi

# shellcheck disable=SC2086
rsync -az $delete_flag \
  --exclude='.ssh' --exclude='.env.production' \
  -e "$SSH_CMD" \
  "${VPS_USER}@${VPS_HOST}:${REMOTE_PATH}" \
  "$LOCAL_PATH"

# ---------------------------------------------------------------------------
# 2. Disaster-recovery credentials
#    One rsync invocation per source: macOS ships rsync 2.6.9, which does not
#    handle multiple remote sources in a single call.
# ---------------------------------------------------------------------------
rsync -az -e "$SSH_CMD" \
  "${VPS_USER}@${VPS_HOST}:~/mathgame/.env.production" \
  "$LOCAL_PATH"

mkdir -p "$LOCAL_PATH/.ssh"
rsync -az -e "$SSH_CMD" \
  "${VPS_USER}@${VPS_HOST}:~/.ssh/github_deploy" \
  "$LOCAL_PATH/.ssh/"
rsync -az -e "$SSH_CMD" \
  "${VPS_USER}@${VPS_HOST}:~/.ssh/github_deploy.pub" \
  "$LOCAL_PATH/.ssh/"

# ---------------------------------------------------------------------------
# 3. Verify. A sync that "succeeds" into an empty or stale directory is exactly
#    the failure this script exists to prevent, so check the result.
# ---------------------------------------------------------------------------
newest=$(ls -t "$LOCAL_PATH"/*.dump 2>/dev/null | head -1 || true)
age_h=""

if [ -z "$newest" ]; then
  note_problem "No .dump files in $LOCAL_PATH after sync."
else
  mtime=$(stat -f %m "$newest" 2>/dev/null || stat -c %Y "$newest")
  age_h=$(( ( $(date +%s) - mtime ) / 3600 ))

  if [ "$age_h" -gt "$MAX_DUMP_AGE_HOURS" ]; then
    note_problem "Newest dump is ${age_h}h old ($(basename "$newest")), threshold ${MAX_DUMP_AGE_HOURS}h. The server's backup job may have stopped."
  fi

  if [ ! -s "$newest" ]; then
    note_problem "Newest dump $(basename "$newest") is EMPTY."
  elif [ "$(head -c 5 "$newest")" != "PGDMP" ]; then
    # The container reads the whole dump back before naming a file, so this is
    # a transfer-integrity check rather than a dump-validity one.
    note_problem "Newest dump $(basename "$newest") lacks the PGDMP header — transfer may be corrupt."
  fi
fi

# .env.production is the DR credential set. A truncated copy here means
# /redeploy brings prod back up with a database password that does not match.
env_file="$LOCAL_PATH/.env.production"
if [ ! -s "$env_file" ]; then
  note_problem ".env.production missing or empty in $LOCAL_PATH — /redeploy would have no prod secrets."
else
  local_keys=$(grep -c '^[A-Z_][A-Z0-9_]*=' "$env_file" || true)
  # $SSH_CMD is intentionally unquoted: it must word-split into ssh + its flags,
  # the same way rsync's -e consumes it above.
  # Capture ssh's own exit status separately. Collapsing "ssh timed out" into
  # remote_keys=0 would alert ".env.production key count mismatch: local 4,
  # VPS 0" — which reads as "the prod env file was emptied" and triggers a
  # panic response to a network blip.
  # shellcheck disable=SC2086
  if remote_keys=$($SSH_CMD "${VPS_USER}@${VPS_HOST}" \
      "grep -c '^[A-Z_][A-Z0-9_]*=' ~/mathgame/.env.production" 2>/dev/null); then
    remote_keys=$(printf '%s' "$remote_keys" | tr -d ' ')
    if [ "$local_keys" -ne "$remote_keys" ]; then
      note_problem ".env.production key count mismatch: local ${local_keys}, server ${remote_keys}."
    fi
  else
    echo "note: could not read .env.production on the server to compare key counts (ssh failed); skipping that check" >&2
  fi
fi

for cred in ".ssh/github_deploy" ".ssh/github_deploy.pub"; do
  [ -s "$LOCAL_PATH/$cred" ] || note_problem "DR credential $cred missing or empty."
done

# ---------------------------------------------------------------------------
# 4. Report
# ---------------------------------------------------------------------------
trap - ERR

if [ ${#PROBLEMS[@]} -gt 0 ]; then
  send_alert "$(printf '%s ' "${PROBLEMS[@]}")"
  exit 1
fi

echo "Backup sync OK: $(ls "$LOCAL_PATH"/*.dump | wc -l | tr -d ' ') dumps, newest $(basename "$newest") (${age_h}h old), $local_keys env keys."
