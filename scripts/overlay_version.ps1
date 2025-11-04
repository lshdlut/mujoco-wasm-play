param(
  [Parameter(Mandatory=$true)] [string]$Version,
  [string]$Prev = '3.3.7'
)
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
$distRoot = Join-Path $root 'dist'
$src = Join-Path $distRoot $Version
$dst = Join-Path $distRoot $Prev
if (!(Test-Path $src)) { throw "Source version not found: $src" }
if (!(Test-Path $dst)) { throw "Dest version folder not found: $dst" }
$backup = Join-Path $distRoot ("_backup_ok_" + ($Prev -replace '[^0-9]+','') )
if (Test-Path $backup) { $backup = "$backup`_" + (Get-Date -UFormat %Y%m%d%H%M%S) }
Write-Host "Backing up $dst -> $backup" -ForegroundColor Yellow
Copy-Item -Recurse -Force $dst $backup
Write-Host "Overlaying $src -> $dst" -ForegroundColor Yellow
Copy-Item -Recurse -Force (Join-Path $src '*') $dst
Write-Host "Done. To restore: scripts/restore_backup.ps1 -Backup '$backup' -Prev '$Prev'" -ForegroundColor Green
