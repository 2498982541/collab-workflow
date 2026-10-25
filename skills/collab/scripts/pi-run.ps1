# Runs one Pi task on DeepSeek V4.1 Flash through OpenCode Go, inside a Windows job object (run it from the project root):
#   pi-run.ps1 -Name phase-2.pi-1 -Effort medium [-Commit]
# Works like codex-run.ps1: reads .collab/runs/<Name>.prompt.md; writes <Name>.jsonl (events), <Name>.last.md
# (final message), <Name>.job (job object name, used by codex-proc.ps1) and <Name>.exit (exit code, written last).
# Every Pi run is a fresh session, kept in .collab/runs/pi-sessions; its id is in the first line of <Name>.jsonl.
# Pi exits by itself once its work has settled; the run ends anyway 30 s after that. Then everything it started is
# killed together, and this script exits with code 0 (Pi's final message ended normally) or 1 (an error such as a
# usage limit, or no final message).
# pi-git-guard.ts lets Pi only read with git; -Commit (a run that does a whole phase or the integration) also lets it commit.
param(
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][ValidateSet('medium', 'high')][string]$Effort,
  [switch]$Commit
)

# Clear any result of an earlier attempt first, so nothing mistakes it for this run's.
Remove-Item ".collab/runs/$Name.exit", ".collab/runs/$Name.last.md" -ErrorAction SilentlyContinue

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CollabJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct Extended {
    public Basic BasicLimits; public Io IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref Extended info, int len);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] public static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  // Puts this process (and so everything it starts) into a job that dies with its last handle.
  public static IntPtr JoinNew(string name) {
    IntPtr job = CreateJobObject(IntPtr.Zero, name);
    var info = new Extended();
    info.BasicLimits.LimitFlags = 0x2000 | 0x800;  // KILL_ON_JOB_CLOSE | BREAKAWAY_OK
    SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(Extended)));
    if (!AssignProcessToJobObject(job, GetCurrentProcess())) throw new Exception("AssignProcessToJobObject failed");
    return job;
  }
}
'@

$runs = '.collab/runs'
$prompt = "$runs/$Name.prompt.md"
$log = "$runs/$Name.jsonl"
if (-not (Test-Path $prompt)) { throw "missing $prompt" }

$jobName = "collab-pi-$PID"
$job = [CollabJob]::JoinNew($jobName)
Set-Content "$runs/$Name.job" $jobName

# PI_TELEMETRY=1 keeps the x-opencode-client header that tells Go the client is Pi; JSON mode sends no install telemetry.
# The prompt file comes in on stdin, which Pi puts before the one-line message.
$env:PI_TELEMETRY = '1'
$env:PI_SKIP_VERSION_CHECK = '1'
$env:COLLAB_PI_GIT = if ($Commit) { 'commit' } else { 'read' }
$exec = "pi --mode json --model opencode-go/deepseek-v4.1-flash --thinking $Effort --session-dir `"$runs/pi-sessions`" -e `"$PSScriptRoot/pi-git-guard.ts`" `"Do the task above.`""
$pi = Start-Process cmd.exe -ArgumentList '/d', '/s', '/c', "`"$exec < `"$prompt`" > `"$log`" 2>&1`"" -NoNewWindow -PassThru

function Test-Settled {
  if (-not (Test-Path $log)) { return $false }
  $fs = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
  try {
    $fs.Seek([Math]::Max(0, $fs.Length - 65536), 'Begin') | Out-Null
    $tail = (New-Object IO.StreamReader($fs)).ReadToEnd()
  } finally { $fs.Close() }
  return $tail -match '"type":"agent_settled"'
}

$endedAt = $null
while (-not $pi.HasExited) {
  if (-not $endedAt) {
    if (Test-Settled) { $endedAt = Get-Date }
  } elseif (((Get-Date) - $endedAt).TotalSeconds -ge 30) { break }  # settled but pi won't exit
  Start-Sleep -Seconds 2
}

$code = (node "$PSScriptRoot/codex-status.mjs" pi-last $log "$runs/$Name.last.md" | Select-Object -First 1)
if ($code -ne '0') { $code = 1 }
Set-Content "$runs/$Name.exit" $code
"pi run '$Name' finished (exit $code)"
[Console]::Out.Flush()
[CollabJob]::TerminateJobObject($job, [uint32]$code) | Out-Null  # kills Pi, its leftovers, and this script
