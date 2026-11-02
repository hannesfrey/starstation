import { useEffect, useState } from 'react'
import { Logo } from './Icons'
import { sfx } from '../sound'
import { input } from '../input'

/** ~3 s boot animation; any key, click or button skips it. */
export function Boot({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'in' | 'out'>('in')

  useEffect(() => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setPhase('out')
      setTimeout(onDone, 350)
    }
    sfx.boot()
    const t = setTimeout(finish, 3000)
    const offAny = input.onAny(finish)
    const click = () => finish()
    window.addEventListener('mousedown', click)
    return () => {
      clearTimeout(t)
      offAny()
      window.removeEventListener('mousedown', click)
    }
  }, [onDone])

  return (
    <div className={`boot ${phase}`} data-testid="boot">
      <div className="boot-inner">
        <Logo size={150} />
        <div className="boot-title">STARSTATION</div>
      </div>
    </div>
  )
}
