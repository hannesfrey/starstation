import { useEffect, useState } from 'react'
import { Logo } from './Icons'
import { sfx } from '../sound'
import { input } from '../input'

/** ~3 s boot animation; any key, click or button skips it. ○ (or Esc) starts safe mode instead. */
export function Boot({ onDone, onSafeMode }: { onDone: () => void; onSafeMode?: () => void }) {
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
    const safe = () => {
      if (done || !onSafeMode) return
      done = true
      onSafeMode()
    }
    // ○ pressed (or already held when the animation starts) → safe mode
    const offBack = input.on((a) => {
      if (a === 'back') safe()
    })
    const held = setInterval(() => {
      const pads = navigator.getGamepads ? [...navigator.getGamepads()] : []
      if (pads.some((p) => p?.connected && p.buttons[1]?.pressed)) safe()
    }, 100)
    // any other key or button skips the animation (after the ○ check has had its turn)
    const offAny = input.onAny(() => setTimeout(finish, 0))
    const click = () => finish()
    window.addEventListener('mousedown', click)
    return () => {
      clearTimeout(t)
      clearInterval(held)
      offBack()
      offAny()
      window.removeEventListener('mousedown', click)
    }
  }, [onDone, onSafeMode])

  return (
    <div className={`boot ${phase}`} data-testid="boot">
      <div className="boot-inner">
        <Logo size={150} />
        <div className="boot-title">STARSTATION</div>
      </div>
    </div>
  )
}
