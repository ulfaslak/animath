#!/bin/bash
# Install (or update) the health watch's launchd agent, com.mathgame.health-watch,
# which runs scripts/health-watch.sh every 10 minutes on this Mac. Run it once
# the prod server exists, deploy.env has its domain and prod's admin CLI has
# `errors`; not before. It is idempotent: re-run it after editing
# scripts/health-watch.sh or the domain.
#
# scripts/install-backup-sync.sh's way, for the same reasons: the agent runs a
# copy installed in ~/Library/Application Support/mathgame, not the repo's
# script (macOS keeps launchd jobs out of some folders, and a checkout can be
# half-way through a merge), written beside it and renamed over it, so a run
# that is reading the old copy is never handed the new one mid-line.
#
# It leaves a test-notification file for the agent, so the first run (at load)
# shows a notification as well as checking: a notification seen on the screen is
# the proof the agent can reach it.
#
# Usage: ./scripts/install-health-watch.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SCRIPT="$SCRIPT_DIR/health-watch.sh"
INSTALL_DIR="$HOME/Library/Application Support/mathgame"
INSTALLED_SCRIPT="$INSTALL_DIR/health-watch.sh"
TEST_FLAG="$INSTALL_DIR/health-watch.test-notification"
LABEL="com.mathgame.health-watch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/mathgame-health-watch.log"

[ -f "$REPO_SCRIPT" ] || { echo "error: $REPO_SCRIPT not found" >&2; exit 1; }
# shellcheck source=../deploy.env
. "$SCRIPT_DIR/../deploy.env"
[ -n "${MATHGAME_DOMAIN:-}" ] || { echo "error: MATHGAME_DOMAIN is empty in deploy.env: there is no server to watch yet" >&2; exit 1; }
[ -f "$HOME/.ssh/mathgame_deploy" ] || { echo "error: ~/.ssh/mathgame_deploy not found: the watch reads the error reports with it" >&2; exit 1; }
for tool in /usr/bin/curl /usr/bin/jq /usr/bin/osascript /usr/bin/ssh; do
  [ -x "$tool" ] || { echo "error: $tool not found: the watch uses the system's own" >&2; exit 1; }
done

mkdir -p "$INSTALL_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cp "$REPO_SCRIPT" "$INSTALLED_SCRIPT.tmp"
chmod +x "$INSTALLED_SCRIPT.tmp"
mv -f "$INSTALLED_SCRIPT.tmp" "$INSTALLED_SCRIPT"
echo "installed script -> $INSTALLED_SCRIPT"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$INSTALLED_SCRIPT</string>
    </array>

    <!-- StartInterval, not StartCalendarInterval: a calendar trigger does not
         fire on a laptop that is asleep at the appointed minute. -->
    <key>StartInterval</key>
    <integer>600</integer>
    <key>RunAtLoad</key>
    <true/>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>MATHGAME_DOMAIN</key>
        <string>$MATHGAME_DOMAIN</string>
    </dict>

    <!-- ~/Library/Logs, not /tmp: /tmp is wiped on reboot. The script keeps the
         log to its last 2,000 to 4,000 lines. -->
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
</dict>
</plist>
PLISTEOF
echo "installed plist  -> $PLIST"

# Where the log ends before the agent loads: this invocation reads only its own run.
log_lines_before=0
if [ -f "$LOG" ]; then log_lines_before=$(wc -l < "$LOG" | tr -d ' '); fi

agent_field() {  # $1 = field name ("state" / "runs")
  launchctl print "gui/$UID/$LABEL" 2>/dev/null \
    | awk -F'= *' -v f="$1" '$0 ~ "^\t" f " = " {print $2; exit}'
}

touch "$TEST_FLAG"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "agent bootstrapped"

# RunAtLoad starts it at once. Wait for the run to finish, by the run counter
# (bootstrap returns before launchd has spawned the job, and while it runs
# `last exit code` is the previous run's).
echo -n "waiting for the first run to complete"
waited=0
while [ "$waited" -lt 300 ]; do
  runs=$(agent_field runs)
  state=$(agent_field state)
  if [ -n "$runs" ] && [ "$runs" -ge 1 ] 2>/dev/null && [ "$state" != "running" ]; then
    break
  fi
  echo -n "."
  sleep 5
  waited=$((waited + 5))
done
echo
[ "$waited" -ge 300 ] && echo "warning: gave up waiting after ${waited}s; the state below may be mid-run"

echo
echo "--- agent state ---"
launchctl print "gui/$UID/$LABEL" | grep -E 'state =|runs =|last exit' | head -4
echo
echo "--- this run's log ---"
if [ -f "$LOG" ]; then
  tail -n "+$((log_lines_before + 1))" "$LOG" | tail -20
else
  echo "(no log: the agent may not have run at all)"
fi
echo
echo "Healthy: runs >= 1, last exit code = 0, an 'up (…)' line above, and a notification"
echo "\"Animath health watch: A test…\" on the screen (and 'notified: …' in the log)."
