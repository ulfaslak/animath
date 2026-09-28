#!/bin/bash
# The health watch: does https://<domain> answer, are its certificates far from
# running out, and did the game's pages report a kind of error not seen
# before? The launchd agent com.mathgame.health-watch runs it every 10 minutes
# on this Mac (scripts/install-health-watch.sh installs it), beside the
# backup sync. It is the interim answer to "where should prod's alerts go"
# (AGENTS/HUMAN_TODO.md): it watches only while this Mac is awake and online.
#
# Every run writes one line to its log, ~/Library/Logs/mathgame-health-watch.log
# (launchd sends it there), and more on trouble. On trouble it shows a macOS
# notification, and posts to Slack too when ~/.config/mathgame/monitoring.env
# sets MONITORING_SLACK_WEBHOOK_URL, as the backup sync does:
#
#   down     /api/health does not answer 200 {"ok":true,"db":true} in three tries,
#            on two runs in a row, while the internet answers this Mac. Said when
#            it goes down, every hour while it stays down, and when it is back.
#   cert     the domain's or www's certificate runs out in under 14 days, or its
#            date cannot be read. Said once a day.
#   errors   the game's pages reported errors of a new kind (a message, or a
#            build, not seen before), read over SSH with the admin CLI's
#            `errors --new --json` in the app's container. Said on every run that
#            finds some. A report's own text never goes into a notification or
#            to Slack, since anyone can send one: the log lists them, and
#            `admin errors` shows them (DEVELOPMENT.md § Errors and health).
#   watch    the error reports cannot be read three runs in a row. Said once,
#            until they can be read again.
#
# It exits 1 while prod is down, a certificate is short or unreadable, or the
# error reports cannot be read; new errors alone exit 0. Its state (where the
# last errors window ended, what it has said) is in
# ~/Library/Application Support/mathgame/health-watch.state. A file named
# health-watch.test-notification beside it makes the next run show a test
# notification and remove the file: the installer leaves one, so its first run
# proves the agent can reach the screen.
#
# Run by hand: ./scripts/health-watch.sh (it reads deploy.env for the domain).

set -uo pipefail

# The installed copy gets the domain from the agent's environment (the
# installer reads deploy.env); run from the repo, it reads deploy.env itself.
if [ -z "${MATHGAME_DOMAIN:-}" ]; then
  DEPLOY_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy.env"
  # shellcheck source=/dev/null
  [ -f "$DEPLOY_ENV" ] && . "$DEPLOY_ENV"
fi
DOMAIN="${MATHGAME_DOMAIN:?MATHGAME_DOMAIN is empty: set it in deploy.env}"

STATE_DIR="$HOME/Library/Application Support/mathgame"
STATE="$STATE_DIR/health-watch.state"
TEST_FLAG="$STATE_DIR/health-watch.test-notification"
LOG="$HOME/Library/Logs/mathgame-health-watch.log"
SSH_KEY="$HOME/.ssh/mathgame_deploy"
CERT_WARN_DAYS=14
DOWN_AFTER_RUNS=2
SAY_DOWN_EVERY_SECONDS=3600
ERRORS_BROKEN_AFTER_RUNS=3
LOG_KEEP_LINES=2000

# The system's own tools (curl, jq, osascript, ssh), whatever PATH the caller
# has: their output is what this parses. HEALTH_WATCH_PATH puts stand-ins
# first, to try the watch's answers without a broken server.
export PATH="${HEALTH_WATCH_PATH:+$HEALTH_WATCH_PATH:}/usr/bin:/bin:/usr/sbin:/sbin"
CURL=curl
JQ=jq
OSASCRIPT=osascript
SSH=ssh

# The webhook lives outside the repo, and is optional.
MONITORING_ENV="$HOME/.config/mathgame/monitoring.env"
# shellcheck source=/dev/null
[ -f "$MONITORING_ENV" ] && . "$MONITORING_ENV"

mkdir -p "$STATE_DIR"
touch "$STATE"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/mathgame-health-watch.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

NOW=$(date -u +%s)
DETAILS=()   # lines under this run's line in the log
TROUBLE=0

state_get() { sed -n "s/^$1=//p" "$STATE" | tail -1; }
state_set() {
  { grep -v "^$1=" "$STATE" || true; printf '%s=%s\n' "$1" "$2"; } > "$STATE.tmp" && mv -f "$STATE.tmp" "$STATE"
}
note() { DETAILS+=("  $1"); }

slack() {
  [ -n "${MONITORING_SLACK_WEBHOOK_URL:-}" ] || return 0
  local payload
  payload=$("$JQ" -cn --arg text ":rotating_light: *Animath health watch*: $1" '{text: $text}')
  "$CURL" -sS --max-time 15 -X POST -H 'Content-Type: application/json' \
    --data "$payload" "$MONITORING_SLACK_WEBHOOK_URL" >/dev/null 2>&1 \
    || note "(the Slack post failed)"
}

# A notification: our own words and numbers, never a report's text. The words
# travel as arguments, never inside the script osascript runs.
notify() {
  local title="$1" message="$2"
  if "$OSASCRIPT" - "$title" "$message" >/dev/null 2>"$TMP/osascript" <<'APPLESCRIPT'
on run argv
	display notification (item 2 of argv) with title (item 1 of argv) sound name "Basso"
end run
APPLESCRIPT
  then
    note "notified: $title: $message"
  else
    note "the notification FAILED ($(head -c 200 "$TMP/osascript" | tr '\n' ' ')): $title: $message"
  fi
  slack "$title: $message"
}

minutes_since() { echo $(( (NOW - $1) / 60 )); }

# ---------------------------------------------------------------------------
# 1. Does the game answer? Three tries, 5 s apart: one connection in eight
#    from this Mac to Hetzner waits 1 to 3 s for its SYN (ENVIRONMENT_NOTES.md).
# ---------------------------------------------------------------------------
HEALTH=down
HEALTH_NOTE=""
for try in 1 2 3; do
  out=$("$CURL" -sS --max-time 20 -w '\n%{http_code} %{time_total}' \
    "https://$DOMAIN/api/health" 2>"$TMP/curl")
  if [ $? -eq 0 ]; then
    meta=$(printf '%s' "$out" | tail -1)
    body=$(printf '%s' "$out" | sed '$d')
    code=${meta%% *}
    seconds=${meta##* }
    ok=$(printf '%s' "$body" | "$JQ" -r '.ok' 2>/dev/null)
    db=$(printf '%s' "$body" | "$JQ" -r '.db' 2>/dev/null)
    sha=$(printf '%s' "$body" | "$JQ" -r '.sha' 2>/dev/null | tr -cd '0-9a-z' | cut -c1-7)
    if [ "$code" = 200 ] && [ "$ok" = true ] && [ "$db" = true ]; then
      HEALTH=up
      HEALTH_NOTE="sha ${sha:-?}, ${seconds}s"
      break
    elif [ "$code" = 503 ] && [ "$ok" = true ]; then
      HEALTH=db-down
      HEALTH_NOTE="its database does not answer"
    else
      HEALTH=down
      HEALTH_NOTE="HTTP $code"
    fi
  else
    HEALTH=down
    HEALTH_NOTE="$(head -c 160 "$TMP/curl" | tr '\n' ' ' | sed 's/ *$//')"
  fi
  [ "$try" -lt 3 ] && sleep 5
done

if [ "$HEALTH" != up ] && ! "$CURL" -sS -o /dev/null --max-time 15 \
    https://www.apple.com/library/test/success.html 2>/dev/null; then
  # This Mac is offline (asleep a moment ago, or on a train): nothing to tell.
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) offline: this Mac reaches neither $DOMAIN nor apple.com; nothing checked"
  exit 0
fi

down_runs=$(state_get down_runs)
down_since=$(state_get down_since)
down_said=$(state_get down_said)
if [ "$HEALTH" = up ]; then
  if [ -n "$down_said" ]; then
    notify "Animath is back" "https://$DOMAIN answers again, after about $(minutes_since "${down_since:-$NOW}") minutes."
  fi
  state_set down_runs 0
  state_set down_since ""
  state_set down_said ""
  status="up ($HEALTH_NOTE)"
else
  TROUBLE=1
  down_runs=$(( ${down_runs:-0} + 1 ))
  state_set down_runs "$down_runs"
  [ -z "$down_since" ] && down_since=$NOW && state_set down_since "$NOW"
  status="DOWN: $HEALTH_NOTE (run $down_runs)"
  if [ "$down_runs" -ge "$DOWN_AFTER_RUNS" ] \
      && { [ -z "$down_said" ] || [ $((NOW - down_said)) -ge "$SAY_DOWN_EVERY_SECONDS" ]; }; then
    if [ "$HEALTH" = db-down ]; then
      notify "Animath is down" "https://$DOMAIN answers, but its database has not for about $(minutes_since "$down_since") minutes."
    else
      notify "Animath is down" "https://$DOMAIN has not answered for about $(minutes_since "$down_since") minutes ($HEALTH_NOTE)."
    fi
    state_set down_said "$NOW"
  fi
fi

# ---------------------------------------------------------------------------
# 2. The certificates, the domain's and www's, while nginx answers at all.
# ---------------------------------------------------------------------------
cert_days() {  # host → days left, from the date curl reads off the certificate
  local end_date end
  end_date=$("$CURL" -sS -v -o /dev/null --max-time 20 "https://$1/api/health" 2>&1 \
    | sed -n 's/^\*[[:space:]]*expire date:[[:space:]]*//p' | head -1)
  [ -n "$end_date" ] || return 1
  end=$(date -j -u -f '%b %d %T %Y %Z' "$(printf '%s' "$end_date" | tr -s ' ')" +%s 2>/dev/null) \
    || return 1
  echo $(( (end - NOW) / 86400 ))
}

certs="certs not checked"
if [ "$HEALTH" != down ]; then
  certs=""
  cert_problem=""
  for host in "$DOMAIN" "www.$DOMAIN"; do
    if days=$(cert_days "$host"); then
      certs="$certs${certs:+, }$host ${days}d"
      [ "$days" -lt "$CERT_WARN_DAYS" ] \
        && cert_problem="$cert_problem${cert_problem:+; }$host's certificate runs out in $days days: it has not renewed"
    else
      certs="$certs${certs:+, }$host ?"
      cert_problem="$cert_problem${cert_problem:+; }the date of $host's certificate cannot be read"
    fi
  done
  if [ -n "$cert_problem" ]; then
    TROUBLE=1
    note "certificate: $cert_problem"
    today=$(date +%Y-%m-%d)
    if [ "$(state_get cert_said)" != "$today" ]; then
      notify "Animath's certificate" "$cert_problem."
      state_set cert_said "$today"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 3. Errors of a new kind, from the reports the game's pages sent, since the
#    last run's window ended (the server's clock: `until`).
# ---------------------------------------------------------------------------
errors="errors not checked"
if [ "$HEALTH" = up ]; then
  since=$(state_get errors_until)
  printf '%s' "$since" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$' \
    || since=""
  # With no window yet, this run only starts one: nothing before it is news.
  remote="cd ~/mathgame && docker compose -f docker-compose.prod.yml exec -T app node dist/admin.mjs errors --new --json --since ${since:-0m}"
  json=$("$SSH" -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=20 \
    -o StrictHostKeyChecking=accept-new "deploy@$DOMAIN" "$remote" 2>"$TMP/ssh")
  ssh_status=$?
  if [ $ssh_status -eq 0 ] && printf '%s' "$json" \
      | "$JQ" -e '(.until | type == "string") and (.groups | type == "array")' >/dev/null 2>&1; then
    state_set errors_until "$(printf '%s' "$json" | "$JQ" -r '.until')"
    state_set errors_failures 0
    state_set errors_broken_said ""
    groups=$(printf '%s' "$json" | "$JQ" '.groups | length')
    reports=$(printf '%s' "$json" | "$JQ" '.reports')
    tests=$(printf '%s' "$json" | "$JQ" '[.groups[] | select(.test)] | length')
    if [ -z "$since" ]; then
      errors="errors: the first window starts now"
    elif [ "$groups" -eq 0 ]; then
      errors="errors: none new"
    else
      errors="errors: $groups new kind(s), $reports report(s)"
      while IFS= read -r line; do note "$line"; done < <(printf '%s' "$json" | "$JQ" -r '.groups[]
        | "\(.count) × \(if .test then "[test] " else "" end)\(.message) (build \(.build[0:7]); \(.modes | keys | join(", ")); \(.browsers | keys | join(", ")))"' \
        | LC_ALL=C tr -d '\000-\010\013-\037\177')
      kinds="$groups new kind"; [ "$groups" -eq 1 ] || kinds="${kinds}s"
      extra=""
      [ "$tests" -gt 0 ] && extra=" ($tests of them sent as a test)"
      notify "Animath: new errors" "$kinds of error in the game's pages$extra. The watch's log lists them; admin errors shows them."
    fi
  else
    failures=$(( $(state_get errors_failures | tr -cd '0-9') + 0 + 1 ))
    state_set errors_failures "$failures"
    errors="errors UNREADABLE (ssh exit $ssh_status, run $failures)"
    note "reading the errors: $(head -c 300 "$TMP/ssh" | tr '\n' ' ')"
    if [ "$failures" -ge "$ERRORS_BROKEN_AFTER_RUNS" ]; then
      TROUBLE=1
      if [ -z "$(state_get errors_broken_said)" ]; then
        notify "Animath health watch" "It has not read the game's error reports for $failures runs in a row. Its log says why."
        state_set errors_broken_said "$NOW"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 4. A test notification, when the installer (or anyone) asked for one.
# ---------------------------------------------------------------------------
if [ -f "$TEST_FLAG" ]; then
  rm -f "$TEST_FLAG"
  notify "Animath health watch" "A test: the watch can reach you. It checks the game every 10 minutes."
fi

# ---------------------------------------------------------------------------
# 5. The log: one line a run, the details under it, the oldest lines let go.
# ---------------------------------------------------------------------------
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $status · $certs · $errors"
for line in ${DETAILS[@]+"${DETAILS[@]}"}; do echo "$line"; done

if [ -f "$LOG" ] && [ "$(wc -l < "$LOG" | tr -d ' ')" -gt $((LOG_KEEP_LINES * 2)) ]; then
  tail -n "$LOG_KEEP_LINES" "$LOG" > "$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"
fi

exit "$TROUBLE"
