import { allConsoles, getEmulator } from './presets'
import { emulatorInstalled } from './emuconfig'
import { biosStatus } from './bios'
import { gameCount } from './library/library'
import type { ConsoleInfo } from '../shared/types'

export function consoleInfos(): ConsoleInfo[] {
  return allConsoles().map((c) => {
    const e = getEmulator(c.emulator)
    const count = gameCount(c.id)
    const installed = emulatorInstalled(c)
    const bios = biosStatus(c)
    const status = !installed ? 'missing-emulator' : !bios.ok ? 'missing-bios' : count === 0 ? 'no-games' : 'ready'
    const statusText = `${c.short} · ${count} game${count === 1 ? '' : 's'} · ${
      !installed ? `${e?.name ?? c.emulator} not installed` : !bios.ok ? `Needs ${bios.missing.join(', ')}` : 'Ready'
    }`
    return {
      id: c.id,
      name: c.name,
      short: c.short,
      order: c.order,
      icon: c.icon,
      emulatorId: c.emulator,
      emulatorName: e?.name ?? c.emulator,
      extensions: c.extensions,
      gameCount: count,
      status,
      statusText,
      netplay: !!c.netplay,
      quickResume: c.quickResume,
      shaderHint: !!c.shaderHint,
      custom: !!c.custom
    }
  })
}
