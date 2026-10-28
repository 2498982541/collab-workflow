# Keeps Windows from sleeping while a /collab run is active (the screen may still turn off).
#   keep-awake.ps1 start  - spawn a hidden watcher tied to the calling Claude Code process
#   keep-awake.ps1 stop   - stop that watcher
# The watcher also exits on its own when Claude Code exits, or after 48 hours.
# Note: this blocks idle sleep only; closing a laptop lid can still suspend the machine.
param(
  [ValidateSet('start', 'stop', 'watch')][string]$Mode = 'start',
  [int]$Owner = 0
)

Add-Type -Namespace Collab -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
$ES_CONTINUOUS_SYSTEM_REQUIRED = [uint32]2147483649  # 0x80000001; a hex literal would be a negative Int32 in PowerShell 5.1

function Find-ClaudePid {
  $id = $PID
  for ($i = 0; $i -lt 15 -and $id; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
    if (-not $p) { break }
    # The desktop app's Claude Code is a versioned binary under .claude\remote\ccd-cli, not claude.exe.
    if ($p.Name -like 'claude*' -or $p.ExecutablePath -like '*\.claude\remote\ccd-cli\*') { return [int]$p.ProcessId }
    $id = $p.ParentProcessId
  }
  return 0
}

if ($Mode -eq 'watch') {
  $deadline = (Get-Date).AddHours(48)
  while ((Get-Date) -lt $deadline) {
    if ($Owner -and -not (Get-Process -Id $Owner -ErrorAction SilentlyContinue)) { break }
    [Collab.Power]::SetThreadExecutionState($ES_CONTINUOUS_SYSTEM_REQUIRED) | Out-Null
    Start-Sleep -Seconds 60
  }
  Remove-Item (Join-Path $env:TEMP "collab-keep-awake-$Owner.pid") -ErrorAction SilentlyContinue
  exit
}

$claude = Find-ClaudePid
$pidFile = Join-Path $env:TEMP "collab-keep-awake-$claude.pid"
# Trust the pid file only if that process really is our watcher (pids get reused).
$running = if (Test-Path $pidFile) {
  $id = (Get-Content $pidFile).Trim()
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
  if ($p -and $p.CommandLine -like '*keep-awake.ps1*watch*') { Get-Process -Id $id }
}

if ($Mode -eq 'start') {
  if ($running) { "keep-awake already running (pid $($running.Id))"; exit }
  # Fail loudly here rather than silently inside the hidden watcher.
  [Collab.Power]::SetThreadExecutionState($ES_CONTINUOUS_SYSTEM_REQUIRED) | Out-Null
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$PSCommandPath`"", 'watch', $claude)
  $p = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList $argList
  Set-Content $pidFile $p.Id
  "keep-awake started (pid $($p.Id), tied to claude pid $claude)"
} else {
  if ($running) { Stop-Process -Id $running.Id -Force }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  'keep-awake stopped'
}
