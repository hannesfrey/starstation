import { describe, expect, it } from 'vitest'
import { ds3Instances, serviceOf } from '../../src/main/ds3'

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
})
