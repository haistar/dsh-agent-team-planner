# Manual install for the production plugin (no pnpm).
# Copies the plugin into the profile node_modules and registers it as a bundle.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-manual.ps1
param(
  [string]$ProfileDir = (Join-Path $env:DSH_HOME 'profiles\web')
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$name = 'dsh-agent-team-planner'

if (-not (Test-Path -LiteralPath (Join-Path $ProfileDir 'package.json'))) { throw "profile not found: $ProfileDir" }

$manifestPath = Join-Path $ProfileDir 'package.json'
$backupPath = Join-Path $ProfileDir 'package.json.atplanner-backup'
if (-not (Test-Path -LiteralPath $backupPath)) {
  Copy-Item -LiteralPath $manifestPath -Destination $backupPath
  Write-Host "backup: $backupPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $manifest.dependencies) { $manifest | Add-Member -MemberType NoteProperty -Name dependencies -Value ([pscustomobject]@{}) -Force }
if ($null -eq $manifest.dependencies.$name) { $manifest.dependencies | Add-Member -MemberType NoteProperty -Name $name -Value "link:$repo" -Force }
if ($null -eq $manifest.dsh) { $manifest | Add-Member -MemberType NoteProperty -Name dsh -Value ([pscustomobject]@{}) -Force }
if ($null -eq $manifest.dsh.profile) { $manifest.dsh | Add-Member -MemberType NoteProperty -Name profile -Value ([pscustomobject]@{}) -Force }
$bundles = @($manifest.dsh.profile.bundles)
if ($bundles -notcontains $name) { $bundles += $name }
$manifest.dsh.profile | Add-Member -MemberType NoteProperty -Name bundles -Value $bundles -Force
$manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$target = Join-Path $ProfileDir "node_modules\$name"
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Path $target | Out-Null
foreach ($item in @('package.json', 'cordis.patch.yml', 'lib', 'README.md', 'README.zh-CN.md')) {
  $source = Join-Path $repo $item
  if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $target -Recurse -Force }
}

Write-Host ""
Write-Host "installed: $target"
Write-Host "manifest updated: $manifestPath"
Write-Host "restart DSH Web, then open the project root session -> right sidebar + -> 'Team' tabs."
