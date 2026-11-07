# Starstation: install the PS3 controller driver (DsHidMini by Nefarius, official GitHub release, bundled).
# Runs elevated (one Windows permission prompt), started by Starstation when the user picks "Install driver".
# Hannes allowed this outside Files\ (2026-11-07): .NET 10 Desktop Runtime (only if missing, needed by the
# DsHidMini setup) + the DsHidMini driver; a PS3 controller still bound to an old driver (SCP's WinUSB)
# is moved over to DsHidMini. Everything is logged to Files\config\logs\ds3-driver.log.
param(
  [Parameter(Mandatory = $true)][string]$Bin,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Log
)
$ErrorActionPreference = 'Stop'
$result = @{ ok = $false; steps = @() }
function Step($s) { $script:result.steps += $s; Write-Output "$(Get-Date -Format s) $s" }
function Save { $script:result | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $Out 'ds3-install.json') }

New-Item -ItemType Directory -Force -Path $Out, (Split-Path $Log) | Out-Null
Start-Transcript -LiteralPath $Log -Append | Out-Null
try {
  $msi = Get-ChildItem -LiteralPath $Bin -Filter 'Nefarius_DsHidMini_Drivers_*.msi' | Select-Object -First 1
  $runtime = Get-ChildItem -LiteralPath $Bin -Filter 'windowsdesktop-runtime-*-win-x64.exe' | Select-Object -First 1
  if (-not $msi) { throw 'DsHidMini setup is missing from Starstation' }

  # SCP Server / Service keep the controller open; they can't work after the switch anyway
  foreach ($n in 'ScpServer', 'ScpService', 'ScpMonitor') {
    Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { Step "closing $($_.ProcessName)"; $_ | Stop-Process -Force }
  }

  # .NET 10 Desktop Runtime: the DsHidMini setup stops without it
  $dotnet = Join-Path $env:ProgramFiles 'dotnet\shared\Microsoft.WindowsDesktop.App'
  $has10 = (Test-Path $dotnet) -and @(Get-ChildItem $dotnet -Directory | Where-Object { $_.Name -like '10.*' }).Count -gt 0
  if (-not $has10) {
    if (-not $runtime) { throw '.NET 10 Desktop Runtime is missing from Starstation' }
    Step "installing $($runtime.Name)"
    $p = Start-Process -FilePath $runtime.FullName -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru
    if ($p.ExitCode -notin 0, 3010, 1638) { throw ".NET runtime setup failed (code $($p.ExitCode))" }
    Step ".NET runtime: code $($p.ExitCode)"
  } else { Step '.NET 10 Desktop Runtime already there' }

  # DsHidMini drivers only (no Bluetooth part, no web page afterwards)
  $msiLog = Join-Path (Split-Path $Log) 'ds3-driver-msi.log'
  Step "installing $($msi.Name)"
  $p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -ArgumentList @('/i', "`"$($msi.FullName)`"", '/qn', '/norestart', 'ADDLOCAL=DsHidMini20Drivers', '/l*v', "`"$msiLog`"") -Wait -PassThru
  if ($p.ExitCode -notin 0, 3010, 1638) { throw "DsHidMini setup failed (code $($p.ExitCode), see ds3-driver-msi.log)" }
  Step "DsHidMini setup: code $($p.ExitCode)"

  # a connected PS3 controller still on another driver (e.g. SCP's WinUSB): move it to DsHidMini
  $pnputil = Join-Path $env:SystemRoot 'System32\pnputil.exe'
  $ds3 = @(Get-PnpDevice -PresentOnly -InstanceId 'USB\VID_054C&PID_0268*' -ErrorAction SilentlyContinue)
  foreach ($d in $ds3) {
    $svc = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_Service').Data
    if ($svc -eq 'dshidmini') { Step "$($d.InstanceId): DsHidMini"; continue }
    $inf = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath').Data
    $prov = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverProvider').Data
    Step "$($d.InstanceId): on '$svc' ($inf, $prov)"
    if ($inf -match '^oem\d+\.inf$' -and $prov -notmatch 'Nefarius') {
      Step "removing old driver $inf ($prov)"
      & $pnputil /delete-driver $inf /uninstall /force | ForEach-Object { Write-Output $_ }
    }
  }
  if ($ds3.Count) {
    & $pnputil /scan-devices | Out-Null
    Start-Sleep -Seconds 4
    foreach ($d in @(Get-PnpDevice -PresentOnly -InstanceId 'USB\VID_054C&PID_0268*' -ErrorAction SilentlyContinue)) {
      $svc = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_Service').Data
      Step "$($d.InstanceId): now '$svc'"
    }
  }
  $result.ok = $true
} catch {
  $result.error = $_.Exception.Message
  Write-Output "ERROR $($_.Exception.Message)"
} finally {
  Save
  Stop-Transcript | Out-Null
}
if ($result.ok) { exit 0 } else { exit 1 }
