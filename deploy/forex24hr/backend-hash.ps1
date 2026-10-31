# Fingerprint of the FinEngine backend: every file under scripts, server, vendor and deploy
# (the folders the server runs), ignoring Python caches. Dot-sourced by install-finengine.ps1
# and auto-update.ps1; Windows PowerShell 5.1.

function Get-BackendHash([string]$Dir) {
    $base = (Resolve-Path $Dir).Path.TrimEnd('\') + '\'
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($top in 'scripts', 'server', 'vendor', 'deploy') {
        $p = Join-Path $Dir $top
        if (-not (Test-Path $p)) { continue }
        Get-ChildItem -Path $p -Recurse -File |
            Where-Object { $_.FullName -notmatch '\\__pycache__\\' -and $_.Extension -ne '.pyc' } |
            ForEach-Object {
                $rel = $_.FullName.Substring($base.Length).Replace('\', '/').ToLowerInvariant()
                $lines.Add($rel + ':' + (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)
            }
    }
    $arr = $lines.ToArray()
    [Array]::Sort($arr, [StringComparer]::Ordinal)
    $sha = [Security.Cryptography.SHA256]::Create()
    $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($arr -join "`n")))
    return ([BitConverter]::ToString($bytes) -replace '-', '')
}
