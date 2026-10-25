#!/usr/bin/env bash
# Linux/WSL twin of pi-run.ps1, same arguments (run it from the project root):
#   pi-run.sh -Name phase-2.pi-1 -Effort medium [-Commit]
# Runs one Pi task on DeepSeek V4.1 Flash through OpenCode Go, the way codex-run.sh runs Codex:
# reads .collab/runs/<Name>.prompt.md; writes <Name>.jsonl (events), <Name>.last.md (final message),
# <Name>.job (systemd scope name, used by codex-proc.sh) and <Name>.exit (exit code, written last).
# Every Pi run is a fresh session, kept in .collab/runs/pi-sessions; its id is in the first line of <Name>.jsonl.
# Pi exits by itself once its work has settled; the run ends anyway 30 s after that.
# Exit code 0 when Pi's final message ended normally, 1 otherwise (an error such as a usage limit, or no final message).
# pi-git-guard.ts lets Pi only read with git; -Commit (a run that does a whole phase or the integration) also lets it commit.
set -u
Name='' Effort='' git=read
while [ $# -gt 0 ]; do
  case "$1" in
    -Name) Name=$2; shift ;; -Effort) Effort=$2; shift ;; -Commit) git=commit ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$Name" ] || { echo "missing -Name" >&2; exit 2; }
case "$Effort" in medium|high) ;; *) echo "-Effort must be medium or high" >&2; exit 2 ;; esac

here=$(dirname "$0")
runs=.collab/runs
prompt="$runs/$Name.prompt.md"
log="$runs/$Name.jsonl"
# Clear any result of an earlier attempt first, so nothing mistakes it for this run's.
rm -f "$runs/$Name.exit" "$runs/$Name.last.md"
[ -f "$prompt" ] || { echo "missing $prompt" >&2; exit 1; }

unit="collab-pi-$$"
echo "$unit" > "$runs/$Name.job"
# If this wrapper is stopped (TaskStop, codex-proc.sh stop), take the whole run down with it.
trap 'systemctl --user stop "$unit.scope" 2>/dev/null' EXIT
trap 'exit 143' TERM INT HUP

# PI_TELEMETRY=1 keeps the x-opencode-client header that tells Go the client is Pi; JSON mode sends no install telemetry.
# The prompt file comes in on stdin, which Pi puts before the one-line message.
PI_TELEMETRY=1 PI_SKIP_VERSION_CHECK=1 COLLAB_PI_GIT=$git systemd-run --user --scope --quiet --collect --unit="$unit" -- \
  pi --mode json --model opencode-go/deepseek-v4.1-flash --thinking "$Effort" --session-dir "$runs/pi-sessions" \
  -e "$here/pi-git-guard.ts" "Do the task above." < "$prompt" > "$log" 2>&1 &
pi=$!

settled() { tail -c 65536 "$log" 2>/dev/null | grep -q '"type":"agent_settled"'; }

ended_at=0
while kill -0 "$pi" 2>/dev/null; do
  if [ "$ended_at" -eq 0 ]; then
    settled && ended_at=$(date +%s)
  elif [ $(( $(date +%s) - ended_at )) -ge 30 ]; then break  # settled but pi won't exit
  fi
  sleep 2
done

code=$(node "$here/codex-status.mjs" pi-last "$log" "$runs/$Name.last.md")
[ "$code" = 0 ] || code=1
echo "$code" > "$runs/$Name.exit"
echo "pi run '$Name' finished (exit $code)"
exit "$code"  # the EXIT trap kills Pi and its leftovers
