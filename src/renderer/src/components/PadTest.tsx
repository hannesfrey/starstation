import { useEffect, useState } from 'react'
import { isMenuPad } from '../input'

/** Settings → Controllers → Test buttons: every button and stick of the first controller, live. */
const NAMES = ['✕ / A', '○ / B', '□ / X', '△ / Y', 'L1', 'R1', 'L2', 'R2', 'Select', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Home']

export function PadTest() {
  const [pad, setPad] = useState<{ id: string; buttons: number[]; axes: number[] } | null>(null)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const p = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((x): x is Gamepad => !!x && x.connected && isMenuPad(x))
      setPad(p ? { id: p.id, buttons: p.buttons.map((b) => b.value), axes: [...p.axes] } : null)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="padtest" data-testid="padtest">
      <div className="padtest-title">Test buttons</div>
      <div className="padtest-name">{pad ? pad.id : 'Press a button on the controller…'}</div>
      <div className="padtest-grid">
        {NAMES.map((n, i) => (
          <div key={n} className={`padtest-btn ${(pad?.buttons[i] ?? 0) > 0.5 ? 'on' : ''}`}>
            {n}
          </div>
        ))}
      </div>
      <div className="padtest-sticks">
        {[0, 2].map((a) => (
          <div key={a} className="padtest-stick">
            <div
              className="padtest-dot"
              style={{ transform: `translate(${(pad?.axes[a] ?? 0) * 34}px, ${(pad?.axes[a + 1] ?? 0) * 34}px)` }}
            />
          </div>
        ))}
      </div>
      <div className="padtest-hint">○ / B or Esc closes this screen.</div>
    </div>
  )
}
