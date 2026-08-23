param(
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$data = Join-Path $repo '.data'
New-Item -ItemType Directory -Force -Path $data | Out-Null
$log = Join-Path $data 'nexo-tray.log'
$pidFile = Join-Path $data 'nexo-daemon.pid'
$url = 'http://127.0.0.1:3210'
$daemon = $null

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\WhatsappCodexNexoTray', [ref]$createdNew)
if (-not $createdNew) {
  if (-not $NoOpen) { Start-Process $url }
  $mutex.Dispose()
  exit 0
}

function Test-Nexo {
  try {
    $r = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 1
    return [bool]$r.ok
  } catch { return $false }
}

function Get-NexoDaemonProcess {
  if (-not (Test-Path $pidFile)) { return $null }
  $saved = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($saved -notmatch '^\d+$') { return $null }
  try { return Get-Process -Id ([int]$saved) -ErrorAction Stop }
  catch {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    return $null
  }
}

function Start-Nexo {
  if (Test-Nexo) { return $true }
  $existing = Get-NexoDaemonProcess
  if ($existing) { return $false }
  $cmd = "cd /d `"$repo`" && pnpm start >> `"$log`" 2>&1"
  $script:daemon = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',$cmd -WindowStyle Hidden -PassThru
  Set-Content -Path $pidFile -Value $script:daemon.Id -Encoding ascii
  for ($i=0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Nexo) { return $true }
    if ($script:daemon.HasExited) { break }
  }
  return $false
}

function Stop-Nexo {
  if ($script:daemon -and -not $script:daemon.HasExited) {
    Stop-Process -Id $script:daemon.Id -Force -ErrorAction SilentlyContinue
  } else {
    $existing = Get-NexoDaemonProcess
    if ($existing) { Stop-Process -Id $existing.Id -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Install-NexoShortcut {
  $installer = Join-Path $PSScriptRoot 'install-shortcut.ps1'
  & $installer | Out-Null
}

Start-Nexo | Out-Null

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add('Abrir Nexo')
$restartItem = $menu.Items.Add('Reiniciar Nexo')
$shortcutItem = $menu.Items.Add('Crear / reparar acceso directo')
$menu.Items.Add('-') | Out-Null
$exitItem = $menu.Items.Add('Salir')

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Text = 'WhatsApp Codex Nexo'
$notify.ContextMenuStrip = $menu
$notify.Visible = $true

$openItem.Add_Click({
  if (-not (Test-Nexo)) { Start-Nexo | Out-Null }
  Start-Process $url
})
$notify.Add_DoubleClick({
  if (-not (Test-Nexo)) { Start-Nexo | Out-Null }
  Start-Process $url
})
$restartItem.Add_Click({
  Stop-Nexo
  Start-Sleep -Milliseconds 500
  Start-Nexo | Out-Null
})
$shortcutItem.Add_Click({
  try {
    Install-NexoShortcut
    $notify.BalloonTipTitle = 'Nexo'
    $notify.BalloonTipText = 'Acceso directo creado o reparado en el escritorio.'
    $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notify.ShowBalloonTip(3000)
  } catch {
    [System.Windows.Forms.MessageBox]::Show(
      "No se pudo crear el acceso directo: $($_.Exception.Message)",
      'Nexo',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  }
})
$exitItem.Add_Click({
  $watchdog.Stop()
  Stop-Nexo
  $notify.Visible = $false
  $notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$watchdog = New-Object System.Windows.Forms.Timer
$watchdog.Interval = 10000
$watchdog.Add_Tick({
  if (-not (Test-Nexo) -and -not (Get-NexoDaemonProcess)) {
    Start-Nexo | Out-Null
  }
})
$watchdog.Start()

if (-not $NoOpen) {
  try {
    $settings = Invoke-RestMethod -Uri "$url/api/settings" -TimeoutSec 2
    if ($settings.settings.openDashboardOnLaunch) { Start-Process $url }
  } catch {}
}

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  $watchdog.Stop()
  $watchdog.Dispose()
  if ($createdNew) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
