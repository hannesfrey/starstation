# Project-only environment for bash (Git Bash): portable Node + gh, every tool cache inside source/tools.
# Usage:  source ./env.sh      (same as env.ps1 for PowerShell)
SS_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SS_TOOLS="$SS_SOURCE/tools"
export PATH="$SS_TOOLS/node:$SS_TOOLS/gh/bin:$PATH"
export npm_config_cache="$SS_TOOLS/cache/npm"
export npm_config_prefix="$SS_TOOLS/node"
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
export ELECTRON_CACHE="$SS_TOOLS/cache/electron" electron_config_cache="$SS_TOOLS/cache/electron"
export ELECTRON_BUILDER_CACHE="$SS_TOOLS/cache/electron-builder"
export PLAYWRIGHT_BROWSERS_PATH="$SS_TOOLS/cache/playwright" PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export GH_CONFIG_DIR="$SS_TOOLS/gh-config"
# tools that keep files in %LOCALAPPDATA% / %APPDATA% (vitest, npm logs) write here instead
export LOCALAPPDATA="$SS_TOOLS/cache/localappdata" APPDATA="$SS_TOOLS/cache/appdata"
export TEMP="$SS_TOOLS/cache/temp" TMP="$SS_TOOLS/cache/temp"
mkdir -p "$TEMP" "$LOCALAPPDATA" "$APPDATA"
