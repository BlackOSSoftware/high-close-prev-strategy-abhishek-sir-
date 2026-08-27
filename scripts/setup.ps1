$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VirtualEnvironment = Join-Path $ProjectRoot ".venv"

if (-not (Test-Path $VirtualEnvironment)) {
    python -m venv $VirtualEnvironment
}

& "$VirtualEnvironment\Scripts\python.exe" -m pip install --upgrade pip
& "$VirtualEnvironment\Scripts\python.exe" -m pip install -e "$ProjectRoot\apps\engine[dev]"
Push-Location "$ProjectRoot\apps\web"
try {
    npm install
    npm run build
} finally {
    Pop-Location
}
Write-Host "Setup complete. Run .\scripts\start.ps1"
