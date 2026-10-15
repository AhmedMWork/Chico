param([Parameter(Mandatory=$true)][string]$RepositoryPath)
$ErrorActionPreference = 'Stop'
$SourceRoot = Split-Path -Parent $PSScriptRoot
$RepositoryRoot = (Resolve-Path -LiteralPath $RepositoryPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot '.git'))) { throw 'Choose the cloned Chico-GitHub repository folder.' }
$RemoteUrl = git -C $RepositoryRoot remote get-url origin
if ($LASTEXITCODE -ne 0 -or $RemoteUrl -notmatch '(github\.com[:/])AhmedMWork/Chico(\.git)?$') { throw 'This is not the intended AhmedMWork/Chico repository.' }
# Copy reviewed source only; keep Git history, local secrets, installed packages and runtime data.
$Excluded = @('.git','node_modules','.next','dist','work','releases','upload','uploads','import-data','qa-output','.wrangler','.vinext','.sites-runtime','.codex','.agents','.owner-provision.json')
Get-ChildItem -LiteralPath $SourceRoot -Force | Where-Object { $_.Name -notin $Excluded -and ($_.Name -notlike '.env*' -or $_.Name -eq '.env.example') -and $_.Name -notlike '*.tsbuildinfo' } | ForEach-Object {
    $Destination = Join-Path $RepositoryRoot $_.Name
    if ($_.PSIsContainer) {
        if (-not (Test-Path -LiteralPath $Destination)) { New-Item -ItemType Directory -Path $Destination | Out-Null }
        Get-ChildItem -LiteralPath $_.FullName -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force }
    } else { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Force }
}
$RetiredFiles = @('lib/domain/preview.ts','components/setup-owner.tsx','public/assets/chico-city-gold.webp','public/assets/chico-city-gold-mobile.webp','public/assets/chico-city-gold-v2.png')
foreach ($RelativeFile in $RetiredFiles) { $File = Join-Path $RepositoryRoot $RelativeFile; if (Test-Path -LiteralPath $File -PathType Leaf) { Remove-Item -LiteralPath $File } }
Write-Host 'Source updated. Secrets and Git history were preserved. Review the changes before committing.'
git -C $RepositoryRoot status --short
