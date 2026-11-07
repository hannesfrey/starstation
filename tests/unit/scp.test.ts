import { describe, expect, it } from 'vitest'
import { ds3OnScp, scpRunning } from '../../src/main/scp'

describe('SCP (PS3 controller driver)', () => {
  it('sees a PS3 controller set up with the SCP driver (WinUSB)', () => {
    const scp = [
      '',
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_054C&PID_0268\\6&37e27229&0&1',
      '    Service    REG_SZ    WinUSB',
      '',
      'Fin de la búsqueda: se encontraron 1 coincidencias.'
    ].join('\r\n')
    expect(ds3OnScp(scp)).toBe(true)
    // Sony's own driver / DsHidMini: no SCP server needed
    expect(ds3OnScp(scp.replace('WinUSB', 'HidUsb'))).toBe(false)
    expect(ds3OnScp(scp.replace('WinUSB', 'dshidmini'))).toBe(false)
    expect(ds3OnScp('')).toBe(false)
  })
  it('finds the running SCP server in tasklist', () => {
    const list = ['"System","4","Services","0","144 KB"', '"ScpServer.exe","46812","Console","2","30.120 KB"'].join('\r\n')
    expect(scpRunning(list)).toBe(true)
    expect(scpRunning('"ScpService.exe","1","Services","0","1 KB"')).toBe(true)
    expect(scpRunning('"steam.exe","1","Console","2","1 KB"\r\n"ScpMonitor.exe","2","Console","2","1 KB"')).toBe(false)
  })
})
