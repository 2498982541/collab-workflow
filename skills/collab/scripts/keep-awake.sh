#!/usr/bin/env bash
# WSL twin of keep-awake.ps1. Keeps Windows from sleeping while a /collab run is active (the screen may still turn off).
#   keep-awake.sh start  - start a watcher tied to the calling Claude Code process
#   keep-awake.sh stop   - stop it
# The Windows side (keep-awake-wsl.ps1) holds the wake request while a flag file exists; a WSL-side watcher
# deletes the flag when Claude Code exits. Closing a laptop lid can still suspend the machine.
set -u
Mode=${1:-start} Owner=${2:-0}
HERE=$(cd "$(dirname "$0")" && pwd)
PS=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe

find_claude() {
  local p=$$ comm ppid
  for _ in $(seq 15); do
    [ -r "/proc/$p/stat" ] || break
    comm=$(cat "/proc/$p/comm")
    case "$comm" in claude*) echo "$p"; return ;; esac
    ppid=$(awk '{ sub(/^.*\) /, ""); print $2 }' "/proc/$p/stat")
    [ "$ppid" -gt 1 ] || break
    p=$ppid
  done
  echo 0
}

if [ "$Mode" = watch ]; then
  flag="/tmp/collab-keep-awake-$Owner.flag"
  (cd /mnt/c && exec "$PS" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$(wslpath -w "$HERE/keep-awake-wsl.ps1")" -Flag "$(wslpath -w "$flag")") </dev/null >/dev/null 2>&1 &
  while [ -e "$flag" ]; do
    if [ "$Owner" -gt 0 ] && ! kill -0 "$Owner" 2>/dev/null; then break; fi
    sleep 30
  done
  rm -f "$flag" "/tmp/collab-keep-awake-$Owner.pid"
  exit 0
fi

claude=$(find_claude)
flag="/tmp/collab-keep-awake-$claude.flag"
pidFile="/tmp/collab-keep-awake-$claude.pid"
# Trust the pid file only if that process really is our watcher (pids get reused).
running=''
if [ -f "$pidFile" ]; then
  id=$(cat "$pidFile")
  if tr '\0' ' ' < "/proc/$id/cmdline" 2>/dev/null | grep -q 'keep-awake.sh watch'; then running=$id; fi
fi

case "$Mode" in
  start)
    if [ -n "$running" ]; then echo "keep-awake already running (pid $running)"; exit 0; fi
    [ -x "$PS" ] || { echo "keep-awake: Windows PowerShell not reachable (WSL interop off?)" >&2; exit 1; }
    touch "$flag"
    setsid nohup bash "$HERE/keep-awake.sh" watch "$claude" </dev/null >/dev/null 2>&1 &
    echo $! > "$pidFile"
    echo "keep-awake started (pid $!, tied to claude pid $claude)"
    ;;
  stop)
    rm -f "$flag"  # the Windows side sees it within 30 s and exits
    [ -n "$running" ] && kill "$running" 2>/dev/null
    rm -f "$pidFile"
    echo 'keep-awake stopped'
    ;;
  *) echo "usage: keep-awake.sh start|stop" >&2; exit 2 ;;
esac
