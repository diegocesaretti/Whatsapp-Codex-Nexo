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

function Test-Nexo {
  try {
    $r = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 1
    return [bool]$r.ok
  } catch { return $false }
}

function Start-Nexo {
  if (Test-Nexo) { return }
  $cmd = "cd /d `"$repo`" && pnpm start >> `"$log`" 2>&1"
  $script:daemon = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',$cmd -WindowStyle Hidden -PassThru
  Set-Content -Path $pidFile -Value $script:daemon.Id -Encoding ascii
  for ($i=0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Nexo) { return }
    if ($script:daemon.HasExited) { break }
  }
}

function Stop-Nexo {
  if ($script:daemon -and -not $script:daemon.HasExited) {
    Stop-Process -Id $script:daemon.Id -Force -ErrorAction SilentlyContinue
  } elseif (Test-Path $pidFile) {
    $saved = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($saved -match '^\d+$') { Stop-Process -Id ([int]$saved) -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

Start-Nexo

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add('Abrir Nexo')
$restartItem = $menu.Items.Add('Reiniciar Nexo')
$menu.Items.Add('-') | Out-Null
$exitItem = $menu.Items.Add('Salir')

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Text = 'WhatsApp Codex Nexo'
$notify.ContextMenuStrip = $menu
$notify.Visible = $true

$openItem.Add_Click({ Start-Process $url })
$notify.Add_DoubleClick({ Start-Process $url })
$restartItem.Add_Click({
  Stop-Nexo
  Start-Sleep -Milliseconds 500
  Start-Nexo
})
$exitItem.Add_Click({
  Stop-Nexo
  $notify.Visible = $false
  $notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

if (-not $NoOpen) {
  try {
    $settings = Invoke-RestMethod -Uri "$url/api/settings" -TimeoutSec 2
    if ($settings.settings.openDashboardOnLaunch) { Start-Process $url }
  } catch {}
}

[System.Windows.Forms.Application]::Run()
