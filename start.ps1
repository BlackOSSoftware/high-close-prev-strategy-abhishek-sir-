[CmdletBinding()]
param(
    [switch]$SkipPull,
    [switch]$ForceSetup,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ProjectRoot = $PSScriptRoot
$WebRoot = Join-Path $ProjectRoot "apps\web"
$EngineRoot = Join-Path $ProjectRoot "apps\engine"
$VenvRoot = Join-Path $ProjectRoot ".venv"
$PythonExe = Join-Path $VenvRoot "Scripts\python.exe"
$StateDir = Join-Path $ProjectRoot ".start-state"
$LogsDir = Join-Path $ProjectRoot "logs"
$StateFile = Join-Path $StateDir "state.json"

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Require-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "'$Name' was not found. $InstallHint"
    }
}
function Get-CombinedHash([string[]]$Paths) {
    $Lines = foreach ($Path in $Paths) {
        if (Test-Path $Path) { "${Path}:$((Get-FileHash -Algorithm SHA256 $Path).Hash)" }
    }
    $Text = ($Lines -join "`n")
    $Sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($Sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace("-", "") }
    finally { $Sha.Dispose() }
}
function Get-WebSourceHash {
    $Files = @(Get-ChildItem $WebRoot -Recurse -File | Where-Object {
        $_.FullName -notmatch '[\\/](node_modules|\.next)[\\/]'
    } | Sort-Object FullName | Select-Object -ExpandProperty FullName)
    return Get-CombinedHash $Files
}
function Get-EngineSourceHash {
    $Files = @(Get-ChildItem (Join-Path $EngineRoot "src") -Recurse -File | Where-Object {
        $_.FullName -notmatch '[\\/](\.pytest_cache|__pycache__)[\\/]'
    } | Sort-Object FullName | Select-Object -ExpandProperty FullName)
    return Get-CombinedHash $Files
}
function Test-ProcessFromFile([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    $SavedPid = (Get-Content $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $SavedPid) { return $null }
    return Get-Process -Id ([int]$SavedPid) -ErrorAction SilentlyContinue
}
function Stop-ManagedProcess([string]$PidFile, [string]$Name) {
    $ManagedProcess = Test-ProcessFromFile $PidFile
    if ($ManagedProcess) {
        Write-Host "Stopping $Name (PID $($ManagedProcess.Id))..." -ForegroundColor DarkGray
        & taskkill.exe /PID $ManagedProcess.Id /T /F 2>$null | Out-Null
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}
function Wait-ForPort([int]$Port, [System.Diagnostics.Process]$Process, [string]$Name, [string]$ErrorLog) {
    for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
        if ($Process.HasExited) {
            $Tail = if (Test-Path $ErrorLog) { (Get-Content $ErrorLog -Tail 30) -join "`n" } else { "No error log created." }
            throw "$Name failed to start (exit $($Process.ExitCode)).`n$Tail"
        }
        $Listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if ($Listening) { return }
        Start-Sleep -Milliseconds 500
        $Process.Refresh()
    }
    throw "$Name did not become ready on port $Port within 15 seconds. Log: $ErrorLog"
}
function Open-SoftwareWindow([string]$Url) {
    $ChromePaths = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )
    $Chrome = $ChromePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($Chrome) {
        $ProfileDir = Join-Path $StateDir "chrome-app-profile"
        $Browser = Start-Process -FilePath $Chrome -ArgumentList "--app=$Url", "--start-maximized", "--user-data-dir=`"$ProfileDir`"", "--no-first-run", "--disable-background-mode" -PassThru
        Write-Host "Chrome software window opened." -ForegroundColor DarkGray
        return $Browser
    }

    $EdgePaths = @(
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
    )
    $Edge = $EdgePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($Edge) {
        $ProfileDir = Join-Path $StateDir "edge-app-profile"
        $Browser = Start-Process -FilePath $Edge -ArgumentList "--app=$Url", "--start-maximized", "--user-data-dir=`"$ProfileDir`"", "--no-first-run", "--disable-background-mode" -PassThru
        Write-Host "Edge software window opened (Chrome was not found)." -ForegroundColor DarkGray
        return $Browser
    }

    Start-Process $Url
    Write-Host "No app-mode browser was found; opened the default browser." -ForegroundColor Yellow
    return $null
}

try {
    Set-Location $ProjectRoot
    New-Item -ItemType Directory -Force -Path $StateDir, $LogsDir | Out-Null
    Require-Command "git" "Install Git, then run start.cmd again."
    Require-Command "node" "Install Node.js 22 or newer, then run start.cmd again."
    Require-Command "npm.cmd" "Install Node.js/npm, then run start.cmd again."

    $NodeMajor = [int]((& node --version).Trim().TrimStart('v').Split('.')[0])
    if ($NodeMajor -lt 22) { throw "Node.js 22 or newer is required. Installed version: $(& node --version)" }

    if (-not $SkipPull) {
        Write-Step "Latest code check"
        $Branch = (& git branch --show-current).Trim()
        $Remote = (& git remote).Trim()
        if ($Branch -and $Remote) {
            & git pull --ff-only
            if ($LASTEXITCODE -ne 0) { throw "Git pull failed. Resolve local changes or a diverged branch, then retry." }
        } else { Write-Host "No Git branch or remote is configured; skipping pull." -ForegroundColor Yellow }
    }

    $PythonCommand = Get-Command "py" -ErrorAction SilentlyContinue
    if (-not $PythonCommand) { $PythonCommand = Get-Command "python" -ErrorAction SilentlyContinue }
    if (-not $PythonCommand -and -not (Test-Path $PythonExe)) {
        throw "Python 3.11-3.13 was not found. Install Python, then run start.cmd again."
    }
    if (-not (Test-Path $PythonExe)) {
        Write-Step "Python virtual environment create"
        if ($PythonCommand.Name -eq "py.exe") { & $PythonCommand.Source -3 -m venv $VenvRoot }
        else { & $PythonCommand.Source -m venv $VenvRoot }
        if ($LASTEXITCODE -ne 0) { throw "Failed to create the Python virtual environment." }
    }

    $PythonVersion = (& $PythonExe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
    if ([version]$PythonVersion -lt [version]"3.11" -or [version]$PythonVersion -ge [version]"3.14") {
        throw "Python 3.11-3.13 is required. The virtual environment uses $PythonVersion; recreate .venv with a supported version."
    }

    $State = @{}
    if (Test-Path $StateFile) {
        try { $State = Get-Content $StateFile -Raw | ConvertFrom-Json }
        catch { $State = @{} }
    }
    $PythonHash = Get-CombinedHash @((Join-Path $EngineRoot "pyproject.toml"))
    $NpmHash = Get-CombinedHash @((Join-Path $WebRoot "package-lock.json"), (Join-Path $WebRoot "package.json"))

    if ($ForceSetup -or $State.pythonHash -ne $PythonHash) {
        Write-Step "Python dependencies install/update"
        & $PythonExe -m pip install --disable-pip-version-check -e "$EngineRoot[dev]"
        if ($LASTEXITCODE -ne 0) { throw "Failed to install Python dependencies." }
    } else { Write-Host "Python dependencies are unchanged; skipping installation." -ForegroundColor DarkGray }

    if ($ForceSetup -or $State.npmHash -ne $NpmHash -or -not (Test-Path (Join-Path $WebRoot "node_modules"))) {
        Write-Step "Node dependencies install"
        Push-Location $WebRoot
        try { & npm.cmd ci --no-audit --no-fund }
        finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw "Failed to install Node dependencies." }
    } else { Write-Host "Node dependencies are unchanged; skipping installation." -ForegroundColor DarkGray }

    $EngineHash = Get-EngineSourceHash
    $WebHash = Get-WebSourceHash
    $EngineChanged = $ForceSetup -or $State.engineHash -ne $EngineHash
    $WebChanged = $ForceSetup -or $State.webHash -ne $WebHash -or -not (Test-Path (Join-Path $WebRoot ".next\BUILD_ID"))
    if ($WebChanged) {
        Write-Step "Production web build"
        Push-Location $WebRoot
        try { & npm.cmd run build }
        finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw "The web production build failed." }
    } else { Write-Host "Web source is unchanged; skipping the build." -ForegroundColor DarkGray }

    @{ pythonHash = $PythonHash; npmHash = $NpmHash; engineHash = $EngineHash; webHash = $WebHash; completedAt = (Get-Date).ToString("o") } |
        ConvertTo-Json | Set-Content -Encoding UTF8 $StateFile

    $Config = Get-Content (Join-Path $ProjectRoot "config\default.json") -Raw | ConvertFrom-Json
    $EnginePort = if ($Config.port) { [int]$Config.port } else { 8765 }
    $EnginePidFile = Join-Path $StateDir "engine.pid"
    $WebPidFile = Join-Path $StateDir "web.pid"
    $EngineProcess = Test-ProcessFromFile $EnginePidFile
    $WebProcess = Test-ProcessFromFile $WebPidFile

    if ($EngineChanged -and $EngineProcess) {
        Write-Step "Updated engine restart"
        Stop-ManagedProcess $EnginePidFile "old trading engine"
        $EngineProcess = $null
    }
    if ($WebChanged -and $WebProcess) {
        Write-Step "Updated web software restart"
        Stop-ManagedProcess $WebPidFile "old web software"
        $WebProcess = $null
    }

    if (-not $EngineProcess) {
        Write-Step "Trading engine start"
        $EngineOut = Join-Path $LogsDir "engine.log"
        $EngineErr = Join-Path $LogsDir "engine-error.log"
        $EngineProcess = Start-Process -FilePath $PythonExe -ArgumentList "-m", "trading_engine.main" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $EngineOut -RedirectStandardError $EngineErr -PassThru
        Set-Content $EnginePidFile $EngineProcess.Id
        Wait-ForPort $EnginePort $EngineProcess "Trading engine" $EngineErr
    } else { Write-Host "Trading engine is already running (PID $($EngineProcess.Id)); skipping startup." -ForegroundColor DarkGray }

    if (-not $WebProcess) {
        Write-Step "Web software start"
        $WebOut = Join-Path $LogsDir "web.log"
        $WebErr = Join-Path $LogsDir "web-error.log"
        $WebProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start" -WorkingDirectory $WebRoot -WindowStyle Hidden -RedirectStandardOutput $WebOut -RedirectStandardError $WebErr -PassThru
        Set-Content $WebPidFile $WebProcess.Id
        Wait-ForPort 3000 $WebProcess "Web software" $WebErr
    } else { Write-Host "Web software is already running (PID $($WebProcess.Id)); skipping startup." -ForegroundColor DarkGray }

    Write-Host "`nREADY: http://127.0.0.1:3000" -ForegroundColor Green
    Write-Host "Logs: $LogsDir" -ForegroundColor DarkGray
    if (-not $NoBrowser) {
        $BrowserProcess = Open-SoftwareWindow "http://127.0.0.1:3000"
        if ($BrowserProcess) {
            Write-Host "Closing this application window will stop the web server and trading engine." -ForegroundColor Yellow
            $BrowserProcess.WaitForExit()
            Write-Step "Application window closed - stopping services"
            Stop-ManagedProcess $WebPidFile "web software"
            Stop-ManagedProcess $EnginePidFile "trading engine"
            Write-Host "Software completely stopped." -ForegroundColor Green
        }
    }
    exit 0
} catch {
    Write-Host "`nSTARTUP ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Logs folder: $LogsDir" -ForegroundColor Yellow
    exit 1
}
