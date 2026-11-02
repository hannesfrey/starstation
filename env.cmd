@echo off
rem Project-only environment: portable Node + gh, all caches inside source\tools
set "SS_TOOLS=%~dp0tools"
set "PATH=%SS_TOOLS%\node;C:\Users\Hannes\Desktop\Starstation\Files\source\tools\gh\bin;%PATH%"
set "npm_config_cache=%SS_TOOLS%\cache\npm"
set "npm_config_prefix=%SS_TOOLS%\node"
set "ELECTRON_CACHE=%SS_TOOLS%\cache\electron"
set "electron_config_cache=%SS_TOOLS%\cache\electron"
set "ELECTRON_BUILDER_CACHE=%SS_TOOLS%\cache\electron-builder"
set "GH_CONFIG_DIR=%SS_TOOLS%\gh-config"
set "TEMP=%SS_TOOLS%\cache\temp"
set "TMP=%SS_TOOLS%\cache\temp"
if not exist "%TMP%" mkdir "%TMP%"