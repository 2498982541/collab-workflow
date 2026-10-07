# Runs one Codex turn inside a Windows job object (run it from the project root):
#   codex-run.ps1 -Name phase-2 -Effort medium                      fresh run
#   codex-run.ps1 -Name phase-2.fix-1 -Effort medium -Resume <id>   resume a thread
#   codex-run.ps1 -Name review -Effort high                         review run (/collab never uses -Sandbox read-only, see SKILL.md Step 4)
#   -Parallel N lets Codex run up to N sub-agents at once (default 1).
# Reads .collab/runs/<Name>.prompt.md; writes <Name>.jsonl (events), <Name>.last.md (final message),
# <Name>.job (job object name, used by codex-proc.ps1) and <Name>.exit (exit code, written last).
# Why the job object: Codex sometimes leaves processes behind (e.g. a dev server from `npm start`).
# They can keep codex.exe from exiting after its turn is done, so the run never "finishes".
# Here the run ends once Codex exits, or 30 s after its turn completes. Then everything it
# started is killed together, and this script exits with code 0 (turn completed) or 1 (failed).
param(
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][ValidateSet('medium', 'high')][string]$Effort,
  [ValidateSet('danger-full-access', 'read-only')][string]$Sandbox = 'danger-full-access',
  [string]$Resume = '',
  [ValidateRange(1, 8)][int]$Parallel = 1
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

$jobName = "collab-codex-$PID"
$job = [CollabJob]::JoinNew($jobName)
Set-Content "$runs/$Name.job" $jobName

$opts = "-c sandbox_mode=$Sandbox -c approval_policy=never -c model_reasoning_effort=$Effort -c agents.max_threads=$Parallel --json -o `"$runs/$Name.last.md`""
$exec = if ($Resume) { "codex exec resume $Resume $opts" } else { "codex exec $opts" }
$codex = Start-Process cmd.exe -ArgumentList '/d', '/s', '/c', "`"$exec - < `"$prompt`" > `"$log`" 2>&1`"" -NoNewWindow -PassThru

function Get-TurnEnd {
  if (-not (Test-Path $log)) { return $null }
  $fs = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
  try {
    $fs.Seek([Math]::Max(0, $fs.Length - 65536), 'Begin') | Out-Null
    $tail = (New-Object IO.StreamReader($fs)).ReadToEnd()
  } finally { $fs.Close() }
  if ($tail -match '"type":"turn\.completed"') { return 0 }
  if ($tail -match '"type":"turn\.failed"') { return 1 }
  return $null
}

$endedAt = $null
$code = 1
while (-not $codex.HasExited) {
  if (-not $endedAt) {
    $end = Get-TurnEnd
    if ($null -ne $end) { $endedAt = Get-Date; $code = $end }
  } elseif (((Get-Date) - $endedAt).TotalSeconds -ge 30) { break }  # turn is done but codex won't exit
  Start-Sleep -Seconds 2
}
if (-not $endedAt) { $end = Get-TurnEnd; if ($null -ne $end) { $code = $end } }

Set-Content "$runs/$Name.exit" $code
"codex run '$Name' finished (exit $code)"
[Console]::Out.Flush()
[CollabJob]::TerminateJobObject($job, [uint32]$code) | Out-Null  # kills Codex, its leftovers, and this script
