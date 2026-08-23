$ErrorActionPreference = 'Stop'

$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$data = Join-Path $repo '.data'
New-Item -ItemType Directory -Force -Path $data | Out-Null
$log = Join-Path $data 'nexo-tray.log'
$url = 'http://127.0.0.1:3210'
$trayScript = Join-Path $PSScriptRoot 'nexo-tray.ps1'

function Test-Nexo {
  try {
    $r = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 1
    return [bool]$r.ok
  } catch { return $false }
}

if (Test-Nexo) {
  Start-Process $url
  exit 0
}

$ps = Join-Path $PSHOME 'powershell.exe'
Start-Process -FilePath $ps -ArgumentList @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-WindowStyle', 'Hidden',
  '-File', "`"$trayScript`"",
  '-NoOpen'
) -WindowStyle Hidden | Out-Null

for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 250
  if (Test-Nexo) {
    Start-Process $url
    exit 0
  }
}

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show(
  "Nexo sigue iniciando. El proceso queda activo y reintentará automáticamente si Neon o el DNS todavía no responden.`r`n`r`nProbá abrir Nexo nuevamente en unos segundos.`r`n`r`nLog: $log",
  'Nexo',
  [System.Windows.Forms.MessageBoxButtons]::OK,
  [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null
