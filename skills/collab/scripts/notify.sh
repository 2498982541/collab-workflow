#!/usr/bin/env bash
# WSL twin of notify.ps1:  notify.sh -Title "..." -Message "..."
# Runs notify.ps1 on the Windows side through WSL interop, so the toast and popup appear on the Windows desktop.
set -u
Title=collab Message=''
while [ $# -gt 0 ]; do
  case "$1" in -Title) Title=$2 ;; -Message) Message=$2 ;; *) echo "unknown argument: $1" >&2; exit 2 ;; esac
  shift 2
done
HERE=$(cd "$(dirname "$0")" && pwd)
PS=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
if [ ! -x "$PS" ]; then echo "notify: Windows PowerShell not reachable (WSL interop off?)" >&2; exit 1; fi
cd /mnt/c && "$PS" -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$HERE/notify.ps1")" -Title "$Title" -Message "$Message"
