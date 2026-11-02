import { useEffect, useState } from 'react'
import type { PadKind } from '../input'

export function TopBar({ pad, battery }: { pad: PadKind | null; battery: number | null }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 15)
    return () => clearInterval(t)
  }, [])
  const date = now.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="topbar" data-testid="clock">
      {pad && (
        <span className="battery" title={battery === null ? 'Controller connected' : `Battery ${battery}%`}>
          <span className="battery-body">
            <span className="battery-fill" style={{ width: `${battery ?? 100}%`, opacity: battery === null ? 0.5 : 1 }} />
          </span>
        </span>
      )}
      <span className="date">{date}</span>
      <span className="time">{time}</span>
    </div>
  )
}
