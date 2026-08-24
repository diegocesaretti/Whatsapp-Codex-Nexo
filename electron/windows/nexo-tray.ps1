$ErrorActionPreference = 'Stop'

$exe = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\Nexo.exe'))
if (-not (Test-Path $exe)) {
  throw "Nexo.exe not found at $exe"
}

Start-Process -FilePath $exe -ArgumentList '--background' -WindowStyle Hidden | Out-Null
