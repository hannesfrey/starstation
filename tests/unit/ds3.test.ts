import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ds3Instances, isDsHidMini, serviceOf, setupCommand } from '../../src/main/ds3'

describe('driver setup command', () => {
  // runs the real command (without the Windows permission prompt) on a stand-in script that records what it got;
  // 2.0.3–2.0.32 split it over two lines, so the script never started and an empty PowerShell waited forever
  it.runIf(process.platform === 'win32')('passes the script and its folders to PowerShell and returns its exit code', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds3 setup O'Brien "))
    try {
      const bin = path.join(root, 'bin')
      fs.mkdirSync(bin)
      const script = path.join(bin, 'ds3-driver.ps1')
      fs.writeFileSync(
        script,
        [
          'param([Parameter(Mandatory = $true)][string]$Bin, [Parameter(Mandatory = $true)][string]$Out, [Parameter(Mandatory = $true)][string]$Log)',
          '"$Bin|$Out|$Log" | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $Out "got.txt")',
          'exit 7'
        ].join('\r\n')
      )
      const out = path.join(root, 'out dir')
      fs.mkdirSync(out)
      const logFile = path.join(root, 'logs', 'ds3-driver.log')
      const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', setupCommand(script, bin, out, logFile, false)], { timeout: 60_000, windowsHide: true })
      expect(r.error).toBeUndefined() // a timeout = the old bug (PowerShell waiting without its script)
      expect(r.status).toBe(7)
      expect(fs.readFileSync(path.join(out, 'got.txt'), 'utf8').replace(/^\uFEFF/, '').trim()).toBe(`${bin}|${out}|${logFile}`)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 90_000)

  it('keeps Start-Process and its arguments on one line', () => {
    const line = setupCommand('C:\\a\\s.ps1', 'C:\\a', 'C:\\o', 'C:\\l.log').split('\n').find((l) => l.includes('Start-Process'))!
    expect(line).toContain('-Verb RunAs')
    expect(line).toContain('-ArgumentList')
    expect(line).toContain("'\"C:\\a\\s.ps1\"'")
  })
})

describe('PS3 controller detection', () => {
  it('finds connected PS3 controllers in pnputil output (any Windows language)', () => {
    const out = [
      'Id. de instancia:                USB\\VID_046D&PID_C52B\\5&1234',
      'Descripción del dispositivo:     USB Receiver',
      '',
      'Id. de instancia:                USB\\VID_054C&PID_0268\\6&37e27229&0&1',
      'Descripción del dispositivo:     PLAYSTATION(R)3 Controller',
      'Nombre del controlador:          oem13.inf',
      '',
      'Instance ID:                     USB\\VID_054C&PID_05C4\\7&abc' // a PS4 controller: no driver needed
    ].join('\r\n')
    expect(ds3Instances(out)).toEqual(['USB\\VID_054C&PID_0268\\6&37e27229&0&1'])
    expect(ds3Instances('')).toEqual([])
  })
  it('reads the driver service from reg query', () => {
    expect(serviceOf('\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\...\\6&37e27229&0&1\r\n    Service    REG_SZ    WinUSB\r\n')).toBe('WinUSB')
    expect(serviceOf('    Service    REG_SZ    dshidmini\r\n')).toBe('dshidmini')
    expect(serviceOf('ERROR: no se encontró')).toBeUndefined()
  })

  it('knows DsHidMini by its maker: it runs under the mshidumdf service (Hannes’s PC after the install)', () => {
    const hannes = [
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_054C&PID_0268\\6&37E27229&0&1',
      '    DeviceDesc    REG_SZ    @oem84.inf,%ds3devicename%;DS3 Compatible HID Device',
      '    Service    REG_SZ    mshidumdf',
      '    Mfg    REG_SZ    @oem84.inf,%manufacturerstring%;Nefarius Software Solutions e.U.',
      '    LowerFilters    REG_MULTI_SZ    WUDFRd\\0nssmkig'
    ].join('\r\n')
    expect(isDsHidMini(hannes)).toBe(true)
    expect(isDsHidMini('    Service    REG_SZ    dshidmini\r\n')).toBe(true)
    // SCP's old WinUSB driver, another UMDF HID driver, nothing
    expect(isDsHidMini('    Service    REG_SZ    WinUSB\r\n    Mfg    REG_SZ    Scarlet.Crush Productions\r\n')).toBe(false)
    expect(isDsHidMini('    Service    REG_SZ    mshidumdf\r\n    Mfg    REG_SZ    Someone Else\r\n')).toBe(false)
    expect(isDsHidMini('')).toBe(false)
  })
})
