# Manual uninstall for the production plugin.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-manual.ps1
param(
  [string]$ProfileDir = (Join-Path $env:DSH_HOME 'profiles\web')
)

$ErrorActionPreference = 'Stop'
$name = 'dsh-agent-team-planner'
$manifestPath = Join-Path $ProfileDir 'package.json'
$backupPath = Join-Path $ProfileDir 'package.json.atplanner-backup'
$target = Join-Path $ProfileDir "node_modules\$name"

if (Test-Path -LiteralPath $backupPath) {
  Copy-Item -LiteralPath $backupPath -Destination $manifestPath -Force
  Write-Host "manifest restored from backup"
} else {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -ne $manifest.dependencies) { $manifest.dependencies.PSObject.Properties.Remove($name) }
  $bundles = @($manifest.dsh.profile.bundles) | Where-Object { $_ -ne $name }
  $manifest.dsh.profile | Add-Member -MemberType NoteProperty -Name bundles -Value $bundles -Force
  $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Write-Host "manifest entry removed"
}

if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
  Write-Host "removed: $target"
}
Write-Host "restart DSH Web to apply."
