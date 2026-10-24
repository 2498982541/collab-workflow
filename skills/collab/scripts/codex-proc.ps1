# Lists or stops every process of one Codex or Pi run (run from the project root):
#   codex-proc.ps1 list <run> [seconds]  - prints the run's processes; no output means the run is not alive.
#                                          With seconds > 0, cpu is the CPU time used during that sample.
#   codex-proc.ps1 stop <run>            - kills them all and marks the run stopped (its codex-run.ps1 or pi-run.ps1 dies too, which wakes Claude)
# A run's processes live in the job object named in .collab/runs/<run>.job (see codex-run.ps1 and pi-run.ps1).
param(
  [Parameter(Mandatory)][ValidateSet('list', 'stop')][string]$Mode,
  [Parameter(Mandatory)][string]$Run,
  [int]$Sample = 0
)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$jobFile = ".collab/runs/$Run.job"
if (-not (Test-Path $jobFile)) { exit }
$jobName = (Get-Content $jobFile -Raw).Trim()

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CollabJobQuery {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll")] static extern bool QueryInformationJobObject(IntPtr job, int cls, IntPtr info, int len, IntPtr ret);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static long[] Pids(string name) {
    IntPtr job = OpenJobObject(0x0004, false, name);  // JOB_OBJECT_QUERY
    if (job == IntPtr.Zero) return new long[0];
    IntPtr buf = Marshal.AllocHGlobal(8 + 8 * 4096);
    try {
      if (!QueryInformationJobObject(job, 3, buf, 8 + 8 * 4096, IntPtr.Zero)) return new long[0];  // BasicProcessIdList
      int n = Marshal.ReadInt32(buf, 4);
      long[] pids = new long[n];
      for (int i = 0; i < n; i++) pids[i] = Marshal.ReadIntPtr(buf, 8 + i * IntPtr.Size).ToInt64();
      return pids;
    } finally { Marshal.FreeHGlobal(buf); CloseHandle(job); }
  }
  public static void Kill(string name) {
    IntPtr job = OpenJobObject(0x0008, false, name);  // JOB_OBJECT_TERMINATE
    if (job != IntPtr.Zero) { TerminateJobObject(job, 1); CloseHandle(job); }
  }
}
'@

function Redact([string]$s) {
  $s = $s -replace '(?i)((token|api[-_]?key|key|secret|password|passwd|auth)["'']?\s*[=: ]\s*["'']?)[^\s"'',;&]+', '$1***'
  $s = $s -replace '(?i)(Bearer\s+)\S+', '$1***'
  $s = $s -replace '(://[^/@\s:]+:)[^@\s]+@', '$1***@'
  $s -replace '\b(sk-|ghp_|gho_|github_pat_|xox[abp]-)[\w-]+', '$1***'
}

$pids = [CollabJobQuery]::Pids($jobName)
if ($Mode -eq 'stop') {
  [CollabJobQuery]::Kill($jobName)
  Set-Content ".collab/runs/$Run.exit" 'stopped'
}

$before = @{}
if ($Sample -gt 0 -and $Mode -eq 'list') {
  foreach ($id in $pids) { $before[$id] = (Get-Process -Id $id -ErrorAction SilentlyContinue).CPU }
  Start-Sleep -Seconds $Sample
}
foreach ($id in $pids) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  if (-not $p) { continue }
  $cpu = (Get-Process -Id $id -ErrorAction SilentlyContinue).CPU
  $cpuText = if ($before.ContainsKey($id)) { 'cpu+{0:N1}s/{1}s' -f ($cpu - $before[$id]), $Sample } else { 'cpu={0:N1}s' -f $cpu }
  $line = (Redact $p.CommandLine) -replace '\s+', ' '
  $line = $line.Substring(0, [Math]::Min(240, $line.Length))
  '{0} {1} {2} started={3:HH:mm:ss} {4}' -f $id, $p.Name, $cpuText, $p.CreationDate, $line
}
