#!/bin/sh
# Production database backup loop. Runs inside the `backup` service
# (postgres:*-alpine) defined in docker-compose.prod.yml, mounted from the
# VPS checkout of this repo at ~/mathgame/scripts/. Dumps land in
# ~/mathgame/backups/ as mathgame_<UTC stamp>.dump, and scripts/sync-backups.sh
# pulls them to the Mac.
#
# Lawcel's scripts/backup.sh, with the names changed: its design notes below
# are its incidents. Alerts go to MONITORING_SLACK_WEBHOOK_URL when it is set
# (the optional .env.monitoring); unset, an alert is only a log line.
#
# POSIX sh only — the container ships busybox ash, not bash.
#
# Design notes:
#   * The dump is written to a .part file and only renamed into place after it
#     passes validation. A failed pg_dump can therefore never leave a file that
#     looks like a backup (the previous inline loop redirected straight to the
#     final name, which is how six 0-byte "backups" were created on 2026-03-21).
#   * Retention runs only after a dump succeeds, so a run of failures can never
#     erode the existing history.
#   * The sleep is computed to the next fixed UTC boundary rather than a flat
#     `sleep 86400`, which drifted forward on every container restart
#     (13:33 -> 19:11 UTC over four months of deploys).
#   * Alerts fire on failure only. Success is silent by design.

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-6}"
DISK_WARN_PCT="${BACKUP_DISK_WARN_PCT:-85}"
DUMP_TIMEOUT_SECONDS="${BACKUP_DUMP_TIMEOUT_SECONDS:-3600}"
LOCK_WAIT_MS="${BACKUP_LOCK_WAIT_MS:-600000}"
# Alert if a new dump is this much smaller than the last accepted one. Catches
# the failure every other check passes: a structurally valid dump of the WRONG
# or a truncated database. Nothing compares dumps to each other otherwise, and
# because retention is age-based the last good dump would age out 30 days
# later with every alarm still green.
SHRINK_WARN_PCT="${BACKUP_SHRINK_WARN_PCT:-50}"

# Set before the required-var check so a misconfigured container can still shout.
MONITORING_SLACK_WEBHOOK_URL="${MONITORING_SLACK_WEBHOOK_URL:-}"

# ---------------------------------------------------------------------------
# Alerting — POSTs a Slack-formatted message to MONITORING_SLACK_WEBHOOK_URL.
# No-ops (with a log line) when the webhook is unset, so the backup loop keeps
# working in environments that have not been wired up to Slack yet.
# ---------------------------------------------------------------------------
alert() {
  _msg="$1"
  echo "ALERT: ${_msg}" >&2

  if [ -z "${MONITORING_SLACK_WEBHOOK_URL:-}" ]; then
    echo "  (MONITORING_SLACK_WEBHOOK_URL unset — alert not delivered)" >&2
    return 0
  fi

  # Escape what would break the JSON string literal. pg_dump's most common
  # error (connection refused) is MULTI-LINE, and a raw newline or tab inside a
  # JSON string is an invalid control character per RFC 8259.
  #
  # Measured against the real Slack webhook: Slack's parser ACCEPTS the raw
  # multi-line payload (HTTP 200) — it is lenient here, and the same endpoint
  # does return 400 for genuinely malformed JSON, a missing `text`, or an empty
  # body, so that 200 is meaningful. So this is defence, not a fix for a broken
  # alert path: `json.loads` rejects the unsanitised payload, and any stricter
  # consumer (or a future Slack that tightens) would too. Keep it.
  _escaped=$(printf '%s' "${_msg}" \
    | tr '\n\r\t' '   ' \
    | tr -d '\000-\037' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  _payload=$(printf '{"text":":rotating_light: *mathgame-prod backup* — %s"}' "${_escaped}")

  if command -v curl >/dev/null 2>&1; then
    curl -sS --max-time 15 -X POST -H 'Content-Type: application/json' \
      --data "${_payload}" "${MONITORING_SLACK_WEBHOOK_URL}" >/dev/null 2>&1 \
      || echo "  (Slack POST failed)" >&2
  else
    wget -q -O /dev/null --timeout=15 \
      --header='Content-Type: application/json' \
      --post-data="${_payload}" "${MONITORING_SLACK_WEBHOOK_URL}" 2>/dev/null \
      || echo "  (Slack POST failed)" >&2
  fi
}

# ---------------------------------------------------------------------------
# Required configuration. Without these the container would crashloop under
# `restart: always` — visible only to whoever thinks to read docker logs, which
# is the silent-failure shape this whole rewrite exists to eliminate. Alert,
# then hold before exiting so the restart loop cannot spam the channel.
# ---------------------------------------------------------------------------
for _var in POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD; do
  eval "_val=\${${_var}:-}"
  if [ -z "${_val}" ]; then
    alert "Cannot start: ${_var} is unset in the backup container's environment. NO BACKUPS ARE RUNNING."
    # Back off across restarts rather than alerting hourly forever. `restart:
    # always` re-runs this script on every exit, so a fixed sleep would post
    # 24 messages a day indefinitely — the volume that gets a channel muted,
    # which is the failure mode this alerting exists to avoid. The marker
    # survives in the mounted backup dir, so the interval widens 1h -> 24h and
    # stays there until a human fixes the config.
    _fails=$(cat "${BACKUP_DIR}/.config-failures" 2>/dev/null || echo 0)
    case "${_fails}" in *[!0-9]*|'') _fails=0 ;; esac
    _fails=$((_fails + 1))
    echo "${_fails}" > "${BACKUP_DIR}/.config-failures" 2>/dev/null || true
    if [ "${_fails}" -ge 4 ]; then _backoff=86400; else _backoff=3600; fi
    echo "config failure #${_fails}; sleeping ${_backoff}s before exit" >&2
    sleep "${_backoff}"
    exit 1
  fi
done
# Configuration is good — reset the backoff counter.
rm -f "${BACKUP_DIR}/.config-failures" 2>/dev/null || true

export PGPASSWORD="${POSTGRES_PASSWORD}"

# ---------------------------------------------------------------------------
# One backup cycle. Returns non-zero on any failure; never leaves a partial
# file behind and never rotates unless the new dump validated.
# ---------------------------------------------------------------------------
run_backup() {
  _stamp=$(date -u +%Y%m%d_%H%M%S)
  _final="${BACKUP_DIR}/mathgame_${_stamp}.dump"
  _part="${_final}.part"

  # `timeout` is not belt-and-braces. pg_dump takes ACCESS SHARE on every table
  # and waits forever behind a conflicting lock — and deploy.sh runs
  # `node dist/migrate.mjs` on this same database on every deploy. A migration
  # holding ACCESS EXCLUSIVE would block pg_dump indefinitely, so run_backup
  # would never return, no alert would ever fire, and the container would sit
  # "up" and healthy forever having silently stopped backing up. A hang must
  # become a failure, because only a failure can shout.
  # Capture pg_dump's real status. `if ! cmd; then _rc=$?` would always read 0,
  # because inside the branch $? is the status of the negation, not of cmd —
  # which would silently disable the rc=124 timeout detection below.
  _rc=0
  _t0=$(date -u +%s)
  PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-30}" \
    timeout "${DUMP_TIMEOUT_SECONDS}" \
    pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
            --lock-wait-timeout="${LOCK_WAIT_MS}" \
            -Fc -f "${_part}" 2>/tmp/pg_dump.err || _rc=$?
  _elapsed=$(( $(date -u +%s) - _t0 ))

  if [ "${_rc}" -ne 0 ]; then
    _err=$(tail -c 400 /tmp/pg_dump.err 2>/dev/null || echo "unknown")
    # Identify a timeout by elapsed time, not by rc=124. GNU timeout returns
    # 124, but busybox timeout (what this alpine image ships) sends TERM and
    # returns pg_dump's own status — 1, with "terminated by user" — which is
    # indistinguishable from an ordinary failure. Verified on the VPS.
    if [ "${_rc}" -eq 124 ] || [ "${_elapsed}" -ge "${DUMP_TIMEOUT_SECONDS}" ]; then
      _err="TIMED OUT after ${_elapsed}s (limit ${DUMP_TIMEOUT_SECONDS}s; blocked on a lock?). ${_err}"
    fi
    rm -f "${_part}"
    alert "pg_dump FAILED at ${_stamp} UTC (rc=${_rc}). No backup written. stderr: ${_err}"
    return 1
  fi

  if [ ! -s "${_part}" ]; then
    rm -f "${_part}"
    alert "pg_dump exited 0 but produced an EMPTY file at ${_stamp} UTC. Discarded."
    return 1
  fi

  # Read the WHOLE archive, not just its table of contents. `pg_restore --list`
  # is not sufficient: the custom format writes its TOC up front, so a dump
  # truncated by a full disk still enumerates perfectly and reports VALID.
  # Measured on the VPS against a real 18MB dump truncated to 8MB: --list
  # passes it, `-f /dev/null` catches it, and an intact dump still passes.
  # Costs ~0.5s, which is nothing next to a 6-hour interval.
  if ! pg_restore -f /dev/null "${_part}" >/dev/null 2>&1; then
    rm -f "${_part}"
    alert "Dump at ${_stamp} UTC is CORRUPT or TRUNCATED (full pg_restore read failed). Discarded."
    return 1
  fi

  # Compare against the most recent accepted dump. A dump can be non-empty and
  # perfectly enumerable while being of the wrong database, or of one whose
  # tables stopped being dumped — every check above passes, and age-based
  # retention then quietly ages out the last good copy. Warn, but still KEEP
  # the dump: a suspicious backup beats no backup, and legitimate shrinkage
  # (a large delete, a pruned table) is a real thing a human should see rather
  # than have silently discarded.
  _prev=$(ls -t "${BACKUP_DIR}"/*.dump 2>/dev/null | head -1 || true)
  if [ -n "${_prev}" ] && [ -f "${_prev}" ]; then
    _new_sz=$(wc -c < "${_part}" | tr -d ' ')
    _old_sz=$(wc -c < "${_prev}" | tr -d ' ')
    if [ "${_old_sz}" -gt 0 ] && [ "$((_new_sz * 100 / _old_sz))" -lt "${SHRINK_WARN_PCT}" ]; then
      alert "Dump at ${_stamp} UTC is $((_new_sz * 100 / _old_sz))% the size of the previous one (${_new_sz} vs ${_old_sz} bytes). KEPT, but check it is the right database."
    fi
  fi

  mv "${_part}" "${_final}"
  echo "$(date -u +%FT%TZ) backup ok: ${_final} ($(du -h "${_final}" | cut -f1))"

  # Only prune once a good dump is on disk.
  find "${BACKUP_DIR}" -name '*.dump' -mtime "+${RETENTION_DAYS}" -delete
  # Sweep any .part files orphaned by a container kill mid-dump.
  find "${BACKUP_DIR}" -name '*.dump.part' -mmin +120 -delete 2>/dev/null || true

  return 0
}

check_disk() {
  _used=$(df -P "${BACKUP_DIR}" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
  if [ -n "${_used}" ] && [ "${_used}" -ge "${DISK_WARN_PCT}" ]; then
    alert "Backup volume is ${_used}% full (warn threshold ${DISK_WARN_PCT}%). Retention is ${RETENTION_DAYS} days at every ${INTERVAL_HOURS}h."
  fi
}

# ---------------------------------------------------------------------------
# Main loop. Dumps immediately on start, then aligns to fixed UTC boundaries.
# ---------------------------------------------------------------------------
echo "backup loop starting: every ${INTERVAL_HOURS}h, ${RETENTION_DAYS}d retention, dir ${BACKUP_DIR}"

while true; do
  run_backup || true
  check_disk || true

  _interval=$((INTERVAL_HOURS * 3600))
  _now=$(date -u +%s)
  # Epoch is midnight UTC, so epoch-aligned boundaries are wall-clock aligned:
  # a 6h interval fires at 00:00 / 06:00 / 12:00 / 18:00 UTC, restart or not.
  _next=$(((_now / _interval + 1) * _interval))
  _sleep=$((_next - _now))
  echo "$(date -u +%FT%TZ) next backup in ${_sleep}s"
  sleep "${_sleep}"
done
