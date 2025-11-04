param(
  [Parameter(Mandatory=$true)] [string]$Backup,
  [string]$Prev = '3.3.7'
)
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
$distRoot = Join-Path $root 'dist'
$dst = Join-Path $distRoot $Prev
if (!(Test-Path $Backup)) { throw "Backup not found: $Backup" }
if (!(Test-Path $dst)) { throw "Dest version folder not found: $dst" }
Write-Host "Restoring $Backup -> $dst" -ForegroundColor Yellow
Remove-Item -Recurse -Force (Join-Path $dst '*')
Copy-Item -Recurse -Force (Join-Path $Backup '*') $dst
Write-Host "Restore done." -ForegroundColor Green
