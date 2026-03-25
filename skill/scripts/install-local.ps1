param(
  [string]$TargetDir = "$HOME/.openclaw/skills/chatgpt-web-submit",
  [ValidateSet('copy','symlink')]
  [string]$Mode = 'copy',
  [string]$Profile = 'default'
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir
$runtimeRoot = Join-Path $bundleRoot 'runtime'
$entry = Join-Path $runtimeRoot 'src\install-local.js'

if (-not (Test-Path $entry)) {
  throw "install-local runtime entry not found: $entry"
}

node $entry --target $TargetDir --mode $Mode --profile $Profile
