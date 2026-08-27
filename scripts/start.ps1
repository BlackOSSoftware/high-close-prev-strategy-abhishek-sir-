$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    throw "Run .\scripts\setup.ps1 first."
}

$Engine = Start-Process -FilePath $Python -ArgumentList "-m", "trading_engine.main" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
$Web = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start" -WorkingDirectory "$ProjectRoot\apps\web" -WindowStyle Hidden -PassThru
Write-Host "Engine PID: $($Engine.Id)"
Write-Host "Web PID: $($Web.Id)"
Write-Host "Open http://127.0.0.1:3000"
