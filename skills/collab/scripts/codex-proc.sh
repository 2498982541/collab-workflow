#!/usr/bin/env bash
# Linux/WSL twin of codex-proc.ps1. Lists or stops every process of one Codex run (run from the project root):
#   codex-proc.sh list <run> [seconds]  - prints the run's processes; no output means the run is not alive.
#                                         With seconds > 0, cpu is the CPU time used during that sample.
#   codex-proc.sh stop <run>            - kills them all and marks the run stopped (codex-run.sh dies too, which wakes Claude)
# A run's processes live in the systemd scope named in .collab/runs/<run>.job (see codex-run.sh).
set -u
Mode=${1:-} Run=${2:-} Sample=${3:-0}
case "$Mode" in list|stop) ;; *) echo "usage: codex-proc.sh list|stop <run> [seconds]" >&2; exit 2 ;; esac
[ -n "$Run" ] || { echo "missing <run>" >&2; exit 2; }
jobFile=".collab/runs/$Run.job"
[ -f "$jobFile" ] || exit 0
unit=$(tr -d '[:space:]' < "$jobFile")

pids() {
  local cg
  cg=$(systemctl --user show -P ControlGroup "$unit.scope" 2>/dev/null)
  [ -n "$cg" ] && cat "/sys/fs/cgroup$cg/cgroup.procs" 2>/dev/null
}

redact() {
  sed -E \
    -e "s/((token|api[-_]?key|key|secret|password|passwd|auth)[\"']?[[:space:]]*[=: ][[:space:]]*[\"']?)[^[:space:]\"',;&]+/\1***/Ig" \
    -e 's/(Bearer[[:space:]]+)[^[:space:]]+/\1***/Ig' \
    -e 's#(://[^/@[:space:]:]+:)[^@[:space:]]+@#\1***@#g' \
    -e 's/\b(sk-|ghp_|gho_|github_pat_|xox[abp]-)[[:alnum:]_-]+/\1***/g'
}

ticks=$(getconf CLK_TCK)
cpu() { awk -v t="$ticks" '{ sub(/^.*\) /, ""); print ($12 + $13) / t }' "/proc/$1/stat" 2>/dev/null; }

if [ "$Mode" = stop ]; then
  wrapper=${unit##*-}
  kill "$wrapper" 2>/dev/null  # its EXIT trap stops the scope
  systemctl --user stop "$unit.scope" 2>/dev/null
  echo stopped > ".collab/runs/$Run.exit"
  exit 0
fi

list=$(pids)
declare -A before
if [ "$Sample" -gt 0 ]; then
  for id in $list; do before[$id]=$(cpu "$id"); done
  sleep "$Sample"
fi
for id in $list; do
  [ -d "/proc/$id" ] || continue
  now=$(cpu "$id")
  if [ -n "${before[$id]:-}" ]; then
    cpuText=$(awk -v a="${before[$id]}" -v b="$now" -v s="$Sample" 'BEGIN { printf "cpu+%.1fs/%ss", b - a, s }')
  else
    cpuText=$(awk -v b="$now" 'BEGIN { printf "cpu=%.1fs", b }')
  fi
  name=$(cat "/proc/$id/comm" 2>/dev/null)
  started=$(date -d "$(ps -o lstart= -p "$id")" +%H:%M:%S 2>/dev/null)
  line=$(tr '\0' ' ' < "/proc/$id/cmdline" 2>/dev/null | redact | tr -s '[:space:]' ' ' | cut -c1-240)
  echo "$id $name $cpuText started=$started $line"
done
