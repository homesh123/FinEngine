# FinEngine live API on the Forex24hr server (Windows Server 2016).
#
#   powershell -ExecutionPolicy Bypass -File C:\FinEngine\install-finengine.ps1
#
# Expects C:\FinEngine\finengine.zip (scripts, server, vendor, deploy from the repo;
# deploy-from-mac.sh uploads it). Safe to run again: it replaces the app, keeps the venv.
#
#   C:\FinEngine\app      the code
#   C:\FinEngine\venv     its own Python environment (TradeSagar's is untouched)
#   C:\FinEngine\logs     api.log, install.log
#   C:\FinEngine\backup   nginx files before each change
#
# The API listens on 127.0.0.1:8100 and nginx serves it at
# https://app.forex24hr.com/finengine/ with the existing certificate.
# It runs as the scheduled task "FinEngine live API" (SYSTEM, at boot), so unlike
# TradeSagar it needs no Remote Desktop log-on after a restart.

param(
    [string]$Zip = 'C:\FinEngine\finengine.zip',
    [string]$SecUserAgent = 'FinEngine forex24hr@zohomail.in',
    [int]$Port = 8100,
    [string]$NginxDir = 'C:\nginx-1.31.4',
    [string]$PublicHost = 'app.forex24hr.com'
)

$ErrorActionPreference = 'Stop'
$Root = 'C:\FinEngine'
$App = Join-Path $Root 'app'
$Venv = Join-Path $Root 'venv'
$Logs = Join-Path $Root 'logs'
$Backup = Join-Path $Root 'backup'
$TaskName = 'FinEngine live API'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

foreach ($d in $Root, $Logs, $Backup) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
Start-Transcript -Path (Join-Path $Logs 'install.log') -Append | Out-Null

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

try {
    # -- 1. the code ---------------------------------------------------------
    Step "Unpacking $Zip"
    if (-not (Test-Path $Zip)) { throw "$Zip not found: upload it first (deploy-from-mac.sh does)" }
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'live_api\.py' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if (Test-Path $App) { Remove-Item -Recurse -Force $App }
    Expand-Archive -Path $Zip -DestinationPath $App -Force
    Copy-Item (Join-Path $App 'deploy\forex24hr\run-api.cmd') (Join-Path $Root 'run-api.cmd') -Force

    # -- 2. Python 3.9+ ------------------------------------------------------
    Step 'Python'
    $py = $null
    foreach ($cand in @('C:\Python312\python.exe', 'py', 'python')) {
        try {
            if ($cand -eq 'py') { $ok = & py -3 -c "import sys;print(sys.version_info>=(3,9))" 2>$null; $exe = (& py -3 -c "import sys;print(sys.executable)" 2>$null) }
            else { $ok = & $cand -c "import sys;print(sys.version_info>=(3,9))" 2>$null; $exe = (& $cand -c "import sys;print(sys.executable)" 2>$null) }
            if ($ok -eq 'True') { $py = $exe; break }
        } catch { }
    }
    if (-not $py) {
        Write-Host 'No Python 3.9+ found: installing Python 3.12 to C:\Python312 (all users, not on PATH)'
        $installer = Join-Path $env:TEMP 'python-3.12.8-amd64.exe'
        Invoke-WebRequest -UseBasicParsing 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe' -OutFile $installer
        Start-Process $installer -ArgumentList '/quiet InstallAllUsers=1 PrependPath=0 Include_test=0 TargetDir=C:\Python312' -Wait
        $py = 'C:\Python312\python.exe'
        if (-not (Test-Path $py)) { throw 'Python install failed' }
    }
    Write-Host "Using $py ($(& $py --version))"

    # -- 3. virtual environment and packages ----------------------------------
    Step 'Packages'
    if (-not (Test-Path (Join-Path $Venv 'Scripts\python.exe'))) { & $py -m venv $Venv }
    $vpy = Join-Path $Venv 'Scripts\python.exe'
    & $vpy -m pip install --quiet --upgrade pip
    & $vpy -m pip install --quiet -r (Join-Path $App 'scripts\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }

    # -- 4. settings ----------------------------------------------------------
    # ASCII, no BOM: run-api.cmd reads KEY=VALUE lines from this file
    [IO.File]::WriteAllText((Join-Path $Root 'finengine.env'), "SEC_USER_AGENT=$SecUserAgent`r`n", [Text.Encoding]::ASCII)

    # -- 5. the port ----------------------------------------------------------
    $busy = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($busy) { throw "Port $Port is already in use by process $($busy[0].OwningProcess)" }

    # -- 6. scheduled task: at boot, as SYSTEM, restarted if it stops --------
    Step "Scheduled task '$TaskName'"
    if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Root\run-api.cmd`""
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
    Start-ScheduledTask -TaskName $TaskName

    Step "Waiting for http://127.0.0.1:$Port/api/health"
    $up = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 2
        try { $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/health" -TimeoutSec 5; if ($r.StatusCode -eq 200) { $up = $true; break } } catch { }
    }
    if (-not $up) { Get-Content (Join-Path $Logs 'api.log') -Tail 30 -ErrorAction SilentlyContinue; throw 'The API did not start (log above)' }
    Write-Host 'API is up.' -ForegroundColor Green

    # -- 7. nginx: /finengine/ on the app.forex24hr.com server blocks ---------
    Step 'nginx'
    $confDir = Join-Path $NginxDir 'conf'
    Copy-Item (Join-Path $App 'deploy\forex24hr\finengine-location.conf') (Join-Path $confDir 'finengine-location.conf') -Force
    $include = '        include finengine-location.conf;  # FinEngine live API'
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $changed = @()
    foreach ($f in Get-ChildItem $confDir -Filter '*.conf') {
        $lines = [IO.File]::ReadAllLines($f.FullName)
        if (($lines -join "`n") -match 'include\s+finengine-location\.conf') { $changed += $f; continue }
        $out = New-Object System.Collections.Generic.List[string]
        $hit = $false
        foreach ($line in $lines) {
            $out.Add($line)
            if ($line -match '^\s*server_name\s' -and $line -match [regex]::Escape($PublicHost)) { $out.Add($include); $hit = $true }
        }
        if ($hit) {
            Copy-Item $f.FullName (Join-Path $Backup "$($f.Name).$stamp") -Force
            [IO.File]::WriteAllLines($f.FullName, $out, (New-Object Text.UTF8Encoding $false))
            $changed += $f
            Write-Host "Added the include to $($f.Name) (backup in $Backup)"
        }
    }
    if (-not $changed) { throw "No nginx server block with server_name $PublicHost found in $confDir" }
    Push-Location $NginxDir
    $test = & .\nginx.exe -t 2>&1
    $testOk = $LASTEXITCODE -eq 0
    Pop-Location
    $test | ForEach-Object { Write-Host $_ }
    if (-not $testOk) {
        foreach ($f in $changed) {
            $b = Join-Path $Backup "$($f.Name).$stamp"
            if (Test-Path $b) { Copy-Item $b $f.FullName -Force }
        }
        throw 'nginx -t failed: the nginx files were restored, nothing was reloaded'
    }
    & 'C:\forex24hr\reload-nginx.cmd'

    # -- 8. check through nginx -------------------------------------------------
    Step "Checking https://$PublicHost/finengine/api/health"
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -UseBasicParsing "https://$PublicHost/finengine/api/health" -TimeoutSec 20
        Write-Host "$($r.StatusCode) $($r.Content)" -ForegroundColor Green
    } catch {
        Write-Host "Could not reach it from the server itself ($($_.Exception.Message)); check from a browser." -ForegroundColor Yellow
    }
    Write-Host "`nDone. Live API URL for the site: https://$PublicHost/finengine" -ForegroundColor Green
}
finally {
    Stop-Transcript | Out-Null
}
