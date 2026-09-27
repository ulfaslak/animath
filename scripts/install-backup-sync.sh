#!/bin/bash
# Install (or update) the offsite backup sync launchd agent,
# com.mathgame.backup-sync, which runs scripts/sync-backups.sh every 6 hours.
# Run it once the prod server exists and deploy.env has its domain; not before.
#
# Lawcel's scripts/install-backup-sync.sh, with the names changed, and the
# domain read from deploy.env here, into the agent's environment.
#
# WHY A COPY. The agent runs a copy installed in ~/Library/Application Support,
# not the repo's script. Lawcel learned it the hard way: its repo sat under
# ~/Documents, which macOS (TCC) keeps from launchd jobs, and the agent failed
# for four months while the script ran fine by hand. This repo lives in ~/git,
# but a copy also keeps the agent off a checkout that is half-way through a
# merge or on another branch. The trade-off: re-run this installer after
# editing scripts/sync-backups.sh or the domain. It is idempotent.
#
# Usage: ./scripts/install-backup-sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SCRIPT="$SCRIPT_DIR/sync-backups.sh"
INSTALL_DIR="$HOME/Library/Application Support/mathgame"
INSTALLED_SCRIPT="$INSTALL_DIR/sync-backups.sh"
LABEL="com.mathgame.backup-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/mathgame-backup-sync.log"

[ -f "$REPO_SCRIPT" ] || { echo "error: $REPO_SCRIPT not found" >&2; exit 1; }
# shellcheck source=../deploy.env
. "$SCRIPT_DIR/../deploy.env"
[ -n "${MATHGAME_DOMAIN:-}" ] || { echo "error: MATHGAME_DOMAIN is empty in deploy.env: there is no server to sync from yet" >&2; exit 1; }
[ -f "$HOME/.ssh/mathgame_deploy" ] || { echo "error: ~/.ssh/mathgame_deploy not found: the sync logs in with it" >&2; exit 1; }

mkdir -p "$INSTALL_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

# Write-then-rename, never cp-in-place. `cp` truncates and rewrites the SAME
# inode; bash reads a script incrementally by byte offset, so re-running this
# installer while the 6-hourly agent is mid-sync would make the running shell
# resume at its old offset inside new content and execute whatever tokens land
# there — with `--delete` rsyncs in scope. `mv` within the same directory is
# atomic and gives a new inode; the running shell keeps reading the old one.
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
    <integer>21600</integer>
    <key>RunAtLoad</key>
    <true/>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>MATHGAME_DOMAIN</key>
        <string>$MATHGAME_DOMAIN</string>
    </dict>

    <!-- ~/Library/Logs, not /tmp: /tmp is wiped on reboot, which destroyed the
         only evidence of why lawcel's agent was failing. -->
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
</dict>
</plist>
PLISTEOF
echo "installed plist  -> $PLIST"

# Remember where the log ends BEFORE bootstrapping, so the verification below
# reads only this invocation's output. Tailing an append-only log would happily
# show the PREVIOUS run's "Backup sync OK" and report a broken install as green.
# The first install has no log yet: 0 lines, and no "No such file" on the screen.
log_lines_before=0
if [ -f "$LOG" ]; then log_lines_before=$(wc -l < "$LOG" | tr -d ' '); fi

agent_field() {  # $1 = field name ("state" / "runs")
  launchctl print "gui/$UID/$LABEL" 2>/dev/null \
    | awk -F'= *' -v f="$1" '$0 ~ "^\t" f " = " {print $2; exit}'
}

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "agent bootstrapped"

# RunAtLoad starts it immediately. Wait for it to FINISH rather than sleeping a
# fixed 10s: while the job is still running, `last exit code` reports the
# PREVIOUS instance's status. Gate on the run counter, not on state alone:
# bootstrap returns before launchd has actually spawned the job.
echo -n "waiting for the first run to complete"
waited=0
while [ "$waited" -lt 900 ]; do
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
[ "$waited" -ge 900 ] && echo "warning: gave up waiting after ${waited}s; state below may be mid-run"

echo
echo "--- agent state ---"
launchctl print "gui/$UID/$LABEL" | grep -E 'state =|runs =|last exit' | head -4
echo
echo "--- this run's log output ---"
if [ -f "$LOG" ]; then
  tail -n "+$((log_lines_before + 1))" "$LOG" | tail -10
else
  echo "(no log produced — the agent may not have run at all)"
fi
echo
echo "Healthy looks like: runs >= 1, last exit code = 0, and a 'Backup sync OK:' line above."
