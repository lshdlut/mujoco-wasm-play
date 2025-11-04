param(
  [Parameter(Mandatory=$true)] [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
$dist = Join-Path $root "dist/$Version"
if (!(Test-Path $dist)) { throw "Dist folder not found: $dist" }

$out = Join-Path $dist 'SHA256SUMS.txt'
Write-Host "Computing SHA256 for files in $dist"
$lines = @()
Get-ChildItem -File $dist | ForEach-Object {
  $h = Get-FileHash -Algorithm SHA256 -Path $_.FullName
  $rel = Split-Path -Leaf $_.FullName
  $lines += "${($h.Hash)}  $rel"
}
Set-Content -Path $out -Value ($lines -join "`n") -NoNewline
Write-Host "Wrote $out" -ForegroundColor Green
