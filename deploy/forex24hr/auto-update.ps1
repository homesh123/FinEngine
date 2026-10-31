# FinEngine auto-update: keeps C:\FinEngine on the latest backend from GitHub.
#
# Run every 5 minutes by the scheduled task "FinEngine auto-update" (SYSTEM), which
# install-finengine.ps1 registers. The server pulls from GitHub, so nothing has to reach
# the server (SSH stays closed to everyone but the home network) and GitHub holds no key.
#
#   1. Ask GitHub for the newest commit on the branch (main).
#   2. Same commit as last time: stop.
#   3. Download that commit and fingerprint scripts, server, vendor and deploy.
#      Same fingerprint as the running backend (only the website changed): record the
#      commit and stop.
#   4. Otherwise install it with that commit's own install-finengine.ps1. If the install
#      fails, reinstall the previous version and skip that commit until a newer one arrives.
#
# Log: C:\FinEngine\logs\auto-update.log (one line per check that finds something).
# Run by hand:  powershell -ExecutionPolicy Bypass -File C:\FinEngine\auto-update.ps1 -Force

param(
    [string]$Repo = 'homesh123/FinEngine',
    [string]$Branch = 'main',
    [switch]$Force          # install even if the backend looks unchanged
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = 'C:\FinEngine'
$Logs = Join-Path $Root 'logs'
$State = Join-Path $Root 'deployed.json'
$Zip = Join-Path $Root 'finengine.zip'
$PrevZip = Join-Path $Root 'finengine.prev.zip'
$Work = Join-Path $Root 'update-work'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$Log = Join-Path $Logs 'auto-update.log'

function Log($text) { Add-Content -Path $Log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text) }

# Only one update at a time (a slow install can outlast the 5-minute interval)
$mutex = New-Object Threading.Mutex($false, 'Global\FinEngineAutoUpdate')
if (-not $mutex.WaitOne(0)) { exit 0 }

function Save-State($obj) { $obj | ConvertTo-Json | Set-Content -Path $State -Encoding ASCII }

function Update-Once {
    $state = if (Test-Path $State) { Get-Content $State -Raw | ConvertFrom-Json } else { $null }
    $headers = @{ 'User-Agent' = 'FinEngine-auto-update'; 'Accept' = 'application/vnd.github+json' }

    # -- 1. newest commit ------------------------------------------------------
    try {
        $commit = Invoke-RestMethod -UseBasicParsing -Headers $headers -TimeoutSec 30 `
            -Uri "https://api.github.com/repos/$Repo/commits/$Branch"
    } catch { Log "GitHub not reachable: $($_.Exception.Message)"; return }
    $sha = $commit.sha
    if (-not $sha) { Log 'GitHub answered without a commit'; return }

    # -- 2. nothing new ----------------------------------------------------------
    if (-not $Force -and $state -and ($state.sha -eq $sha -or $state.failed_sha -eq $sha)) { return }

    # -- 3. download and fingerprint --------------------------------------------
    if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
    New-Item -ItemType Directory -Force -Path $Work | Out-Null
    $download = Join-Path $Work 'repo.zip'
    Invoke-WebRequest -UseBasicParsing -Headers $headers -TimeoutSec 300 -OutFile $download `
        -Uri "https://codeload.github.com/$Repo/zip/$sha"
    Expand-Archive -Path $download -DestinationPath (Join-Path $Work 'repo') -Force
    $src = Get-ChildItem (Join-Path $Work 'repo') -Directory | Select-Object -First 1   # FinEngine-<sha>
    if (-not (Test-Path (Join-Path $src.FullName 'server\live_api.py'))) { throw "Commit $sha has no server\live_api.py" }

    . (Join-Path $src.FullName 'deploy\forex24hr\backend-hash.ps1')
    $hash = Get-BackendHash $src.FullName
    $short = $sha.Substring(0, 7)
    if (-not $Force -and $state -and $state.hash -eq $hash) {
        $state | Add-Member -Force -NotePropertyName sha -NotePropertyValue $sha
        $state | Add-Member -Force -NotePropertyName checked -NotePropertyValue (Get-Date -Format s)
        Save-State $state
        Log "$short`: no backend change (website only), nothing to install"
        return
    }

    # -- 4. install --------------------------------------------------------------
    Log "$short`: backend changed ($($commit.commit.message.Split("`n")[0])), installing"
    $pack = Join-Path $Work 'pack'
    New-Item -ItemType Directory -Force -Path $pack | Out-Null
    foreach ($d in 'scripts', 'server', 'vendor', 'deploy') {
        $p = Join-Path $src.FullName $d
        if (Test-Path $p) { Copy-Item -Recurse -Path $p -Destination $pack }
    }
    if (Test-Path $Zip) { Copy-Item $Zip $PrevZip -Force }
    $oldInstaller = Join-Path $Work 'previous-install-finengine.ps1'
    $haveOld = Test-Path (Join-Path $Root 'install-finengine.ps1')
    if ($haveOld) { Copy-Item (Join-Path $Root 'install-finengine.ps1') $oldInstaller -Force }
    $newZip = Join-Path $Work 'finengine.zip'
    Compress-Archive -Path (Join-Path $pack '*') -DestinationPath $newZip -Force
    Copy-Item $newZip $Zip -Force
    $installer = Join-Path $src.FullName 'deploy\forex24hr\install-finengine.ps1'

    # The installer keeps its own transcript in logs\install.log
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Zip $Zip -FromAutoUpdate -Sha $sha | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Log "$short`: installed, API healthy"
    } else {
        Log "$short`: install FAILED (exit $LASTEXITCODE, see install.log); going back to the previous version"
        if ((Test-Path $PrevZip) -and $haveOld) {
            Copy-Item $PrevZip $Zip -Force
            $back = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $oldInstaller, '-Zip', $Zip, '-FromAutoUpdate')
            if ($state -and $state.sha) { $back += @('-Sha', [string]$state.sha) }
            & powershell @back | Out-Null
            Log "previous version reinstalled: exit $LASTEXITCODE"
        }
        # Don't retry this commit every 5 minutes; the next commit is tried as usual
        $state = if (Test-Path $State) { Get-Content $State -Raw | ConvertFrom-Json } else { New-Object psobject }
        $state | Add-Member -Force -NotePropertyName failed_sha -NotePropertyValue $sha
        Save-State $state
    }
}

try {
    Update-Once
}
catch {
    Log "auto-update error: $($_.Exception.Message)"
}
finally {
    if (Test-Path $Work) { Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue }
    $mutex.ReleaseMutex()
}
