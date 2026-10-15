#!/usr/bin/env bash
# Linux/WSL twin of codex-run.ps1, same arguments (run it from the project root):
#   codex-run.sh -Name phase-2 -Effort medium                      fresh run
#   codex-run.sh -Name phase-2.fix-1 -Effort medium -Resume <id>   resume a thread
#   -Parallel N lets Codex run up to N sub-agents at once (default 1).
# Reads .collab/runs/<Name>.prompt.md; writes <Name>.jsonl (events), <Name>.last.md (final message),
# <Name>.job (systemd scope name, used by codex-proc.sh) and <Name>.exit (exit code, written last).
# Instead of a Windows job object, Codex runs in a transient systemd user scope (a cgroup), so
# everything it starts, even daemonized dev servers, is killed together once the run ends.
# The run ends once Codex exits, or 30 s after its turn completes; exit code 0 (turn completed) or 1 (failed).
set -u
Name='' Effort='' Sandbox='danger-full-access' Resume='' Parallel=1
while [ $# -gt 0 ]; do
  case "$1" in
    -Name) Name=$2 ;; -Effort) Effort=$2 ;; -Sandbox) Sandbox=$2 ;; -Resume) Resume=$2 ;; -Parallel) Parallel=$2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift 2
done
[ -n "$Name" ] || { echo "missing -Name" >&2; exit 2; }
case "$Effort" in medium|high) ;; *) echo "-Effort must be medium or high" >&2; exit 2 ;; esac
case "$Sandbox" in danger-full-access|read-only) ;; *) echo "bad -Sandbox" >&2; exit 2 ;; esac
case "$Parallel" in [1-8]) ;; *) echo "-Parallel must be 1-8" >&2; exit 2 ;; esac

runs=.collab/runs
prompt="$runs/$Name.prompt.md"
log="$runs/$Name.jsonl"
# Clear any result of an earlier attempt first, so nothing mistakes it for this run's.
rm -f "$runs/$Name.exit" "$runs/$Name.last.md"
[ -f "$prompt" ] || { echo "missing $prompt" >&2; exit 1; }

unit="collab-codex-$$"
echo "$unit" > "$runs/$Name.job"
# If this wrapper is stopped (TaskStop, codex-proc.sh stop), take the whole run down with it.
trap 'systemctl --user stop "$unit.scope" 2>/dev/null' EXIT
trap 'exit 143' TERM INT HUP

opts=(-c "sandbox_mode=$Sandbox" -c approval_policy=never -c "model_reasoning_effort=$Effort" -c "agents.max_threads=$Parallel" --json -o "$runs/$Name.last.md")
if [ -n "$Resume" ]; then cmd=(codex exec resume "$Resume" "${opts[@]}"); else cmd=(codex exec "${opts[@]}"); fi
systemd-run --user --scope --quiet --collect --unit="$unit" -- "${cmd[@]}" - < "$prompt" > "$log" 2>&1 &
codex=$!

turn_end() {
  local tail
  tail=$(tail -c 65536 "$log" 2>/dev/null) || return 1
  case "$tail" in
    *'"type":"turn.completed"'*) echo 0 ;;
    *'"type":"turn.failed"'*) echo 1 ;;
  esac
}

ended_at=0
code=1
while kill -0 "$codex" 2>/dev/null; do
  if [ "$ended_at" -eq 0 ]; then
    end=$(turn_end)
    if [ -n "$end" ]; then ended_at=$(date +%s); code=$end; fi
  elif [ $(( $(date +%s) - ended_at )) -ge 30 ]; then break  # turn is done but codex won't exit
  fi
  sleep 2
done
if [ "$ended_at" -eq 0 ]; then end=$(turn_end); [ -n "$end" ] && code=$end; fi

echo "$code" > "$runs/$Name.exit"
echo "codex run '$Name' finished (exit $code)"
exit "$code"  # the EXIT trap kills Codex and its leftovers
