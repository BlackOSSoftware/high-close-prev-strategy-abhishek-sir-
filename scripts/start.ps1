$ProjectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $ProjectRoot "start.ps1") @args
exit $LASTEXITCODE
