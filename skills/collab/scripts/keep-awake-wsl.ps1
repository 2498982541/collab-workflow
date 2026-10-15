# Windows half of keep-awake.sh: keeps Windows (and so the WSL VM) from idle-sleeping while the flag file exists.
# The flag lives on the WSL side; keep-awake.sh deletes it on stop, or when Claude Code exits. Gives up after 48 hours.
param([Parameter(Mandatory)][string]$Flag)

Add-Type -Namespace Collab -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
$ES_CONTINUOUS_SYSTEM_REQUIRED = [uint32]2147483649  # 0x80000001

$deadline = (Get-Date).AddHours(48)
while ((Get-Date) -lt $deadline -and (Test-Path -LiteralPath $Flag)) {
  [Collab.Power]::SetThreadExecutionState($ES_CONTINUOUS_SYSTEM_REQUIRED) | Out-Null
  Start-Sleep -Seconds 30
}
