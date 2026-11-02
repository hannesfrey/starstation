import { spawn } from 'node:child_process'
import { logger } from './log'
import { parseBattery, type BatteryInfo } from './formats/xinput'

export type { BatteryInfo }

/**
 * Controller battery via XInput (the Gamepad API has none). A small hidden PowerShell call reads
 * XInputGetBatteryInformation for pad 0 about once a minute while the menu is shown.
 */

const log = logger('battery')

const SCRIPT = [
  "$sig = '[StructLayout(LayoutKind.Sequential)] public struct BI { public byte Type; public byte Level; } [DllImport(\"xinput1_4.dll\")] public static extern uint XInputGetBatteryInformation(uint i, byte t, out BI b);'",
  'Add-Type -MemberDefinition $sig -Name X -Namespace StarstationBattery',
  '$b = New-Object StarstationBattery.X+BI',
  '$r = [StarstationBattery.X]::XInputGetBatteryInformation(0, 0, [ref]$b)',
  '"$r $($b.Type) $($b.Level)"'
].join('; ')

export function readBattery(): Promise<BatteryInfo | null> {
  return new Promise((resolve) => {
    let out = ''
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const t = setTimeout(() => p.kill(), 15_000)
    p.stdout.on('data', (d: Buffer) => (out += d.toString()))
    p.once('error', (e) => {
      clearTimeout(t)
      log.warn('battery read failed', e)
      resolve(null)
    })
    p.once('exit', () => {
      clearTimeout(t)
      resolve(parseBattery(out))
    })
  })
}
