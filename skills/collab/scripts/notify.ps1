# Notifies the user:  notify.ps1 -Title "..." -Message "..."
# Sends a toast (kept in the notification center) plus a topmost popup that stays until closed,
# so the message is seen even when Do Not Disturb hides toast banners.
param([string]$Title = 'collab', [string]$Message = '', [switch]$Popup)

if ($Popup) {
  (New-Object -ComObject WScript.Shell).Popup($Message, 0, $Title, 0x40040) | Out-Null  # info icon, topmost
  exit
}

try {
  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
  $t = [Security.SecurityElement]::Escape($Title)
  $m = [Security.SecurityElement]::Escape($Message)
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml("<toast><visual><binding template=`"ToastGeneric`"><text>$t</text><text>$m</text></binding></visual></toast>")
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
} catch {}

# The popup blocks until closed, so show it from a detached process.
$q = { param($s) '"' + ($s -replace '"', "'") + '"' }
Start-Process powershell -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (& $q $PSCommandPath),
  '-Popup', '-Title', (& $q $Title), '-Message', (& $q $Message))
