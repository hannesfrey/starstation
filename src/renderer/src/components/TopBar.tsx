import { useEffect, useState } from 'react'
import type { PadKind } from '../input'
import type { BatteryInfo } from '../../../shared/types'

export function TopBar({ pad, battery }: { pad: PadKind | null; battery: BatteryInfo | null }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 15)
    return () => clearInterval(t)
  }, [])
  const date = now.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const level = battery?.level ?? null
  const title = battery?.wired ? 'Controller (wired)' : level === null ? 'Controller connected' : `Controller battery ${level}%`
  return (
    <div className="topbar" data-testid="clock">
      {(pad || battery) && (
        <span className={`battery ${level !== null && level <= 30 ? 'low' : ''}`} title={title} data-testid="battery">
          {battery?.wired ? (
            <svg className="plug" width="18" height="16" viewBox="0 0 18 16" aria-label="wired">
              <path d="M5 1v4M11 1v4M3 5h10v3a5 5 0 0 1-10 0zM8 13v3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </svg>
          ) : (
            <span className="battery-body">
              <span className="battery-fill" style={{ width: `${level ?? 100}%`, opacity: level === null ? 0.5 : 1 }} />
            </span>
          )}
        </span>
      )}
      <span className="date">{date}</span>
      <span className="time">{time}</span>
    </div>
  )
}
