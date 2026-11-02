# Project-only environment for PowerShell: portable Node + gh, all caches inside source\tools.
# Usage:  . .\env.ps1
$SS_SOURCE = $PSScriptRoot
$SS_TOOLS = Join-Path $PSScriptRoot 'tools'
$env:PATH = "$SS_TOOLS\node;$SS_TOOLS\gh\bin;" + $env:PATH
$env:npm_config_cache = "$SS_TOOLS\cache\npm"
$env:npm_config_prefix = "$SS_TOOLS\node"
$env:npm_config_update_notifier = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_audit = 'false'
$env:ELECTRON_CACHE = "$SS_TOOLS\cache\electron"
$env:electron_config_cache = "$SS_TOOLS\cache\electron"
$env:ELECTRON_BUILDER_CACHE = "$SS_TOOLS\cache\electron-builder"
$env:PLAYWRIGHT_BROWSERS_PATH = "$SS_TOOLS\cache\playwright"
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
$env:GH_CONFIG_DIR = "$SS_TOOLS\gh-config"
$env:TEMP = "$SS_TOOLS\cache\temp"
$env:TMP = "$SS_TOOLS\cache\temp"
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
