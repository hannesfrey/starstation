import type { ReactElement } from 'react'
import type { PadKind } from '../input'

export type GlyphButton = 'confirm' | 'back' | 'options' | 'search' | 'start' | 'select' | 'l1' | 'r1'

/**
 * Button prompts, drawn (not font characters: ✕ ○ △ □ came out in four different sizes and heights).
 * Face buttons: a dark disc with the symbol in its colour; shoulders: a bumper shape; start/select: a small pill.
 */

const PS_COLORS: Record<'confirm' | 'back' | 'options' | 'search', string> = { confirm: '#8db8ff', back: '#ff8f8f', options: '#6fe3bd', search: '#f3a6e2' }
const XB_COLORS: Record<'confirm' | 'back' | 'options' | 'search', string> = { confirm: '#6ccf6c', back: '#f06a63', options: '#f5c24c', search: '#5ea8f2' }
const XB_LETTER = { confirm: 'A', back: 'B', options: 'Y', search: 'X' } as const

const DISC = <circle cx="12" cy="12" r="10.6" fill="rgba(6,10,24,.55)" stroke="rgba(255,255,255,.55)" strokeWidth="1.1" />

const PS_SYMBOL: Record<'confirm' | 'back' | 'options' | 'search', ReactElement> = {
  confirm: <path d="M8.3 8.3l7.4 7.4M15.7 8.3l-7.4 7.4" />,
  back: <circle cx="12" cy="12" r="4.6" />,
  options: <path d="M12 7.4l4.9 8.3H7.1z" />,
  search: <rect x="7.8" y="7.8" width="8.4" height="8.4" rx=".4" />
}

function Face({ kind, button }: { kind: PadKind; button: 'confirm' | 'back' | 'options' | 'search' }) {
  const xbox = kind === 'xbox'
  const color = (xbox ? XB_COLORS : PS_COLORS)[button]
  return (
    <svg className="glyph" viewBox="0 0 24 24" width="24" height="24" aria-label={xbox ? XB_LETTER[button] : button}>
      {DISC}
      {xbox ? (
        <text x="12" y="16.3" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={color} fontFamily="system-ui, sans-serif">
          {XB_LETTER[button]}
        </text>
      ) : (
        <g fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {PS_SYMBOL[button]}
        </g>
      )}
    </svg>
  )
}

/** L1 / R1 (LB / RB): a bumper — flat bottom, rounded top, slanted toward its side. */
function Shoulder({ label, right }: { label: string; right: boolean }) {
  const d = right ? 'M3 19.5h26.5V12c0-4.5-3-7.5-7.5-7.5H9.5C5.5 4.5 3 8 3 12z' : 'M2.5 19.5H29V12c0-4-2.5-7.5-6.5-7.5H10C5.5 4.5 2.5 7.5 2.5 12z'
  return (
    <svg className="glyph" viewBox="0 0 32 24" width="32" height="24" aria-label={label}>
      <path d={d} fill="rgba(6,10,24,.55)" stroke="rgba(255,255,255,.6)" strokeWidth="1.1" strokeLinejoin="round" />
      <text x="16" y="16.2" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#e8eefc" fontFamily="system-ui, sans-serif">
        {label}
      </text>
    </svg>
  )
}

/** START / SELECT (MENU / VIEW): a small pill. */
function Pill({ label }: { label: string }) {
  const w = Math.max(36, label.length * 7 + 14)
  return (
    <svg className="glyph" viewBox={`0 0 ${w} 24`} width={w} height="24" aria-label={label}>
      <rect x="1" y="4.5" width={w - 2} height="15" rx="7.5" fill="rgba(6,10,24,.55)" stroke="rgba(255,255,255,.55)" strokeWidth="1.1" />
      <text x={w / 2} y="15.2" textAnchor="middle" fontSize="8.6" fontWeight="700" letterSpacing=".5" fill="#e8eefc" fontFamily="system-ui, sans-serif">
        {label}
      </text>
    </svg>
  )
}

export function Glyph({ button, kind }: { button: GlyphButton; kind: PadKind }) {
  const xbox = kind === 'xbox'
  if (button === 'confirm' || button === 'back' || button === 'options' || button === 'search') return <Face kind={kind} button={button} />
  if (button === 'l1' || button === 'r1') return <Shoulder label={xbox ? (button === 'l1' ? 'LB' : 'RB') : button.toUpperCase()} right={button === 'r1'} />
  return <Pill label={xbox ? (button === 'start' ? 'MENU' : 'VIEW') : button.toUpperCase()} />
}

export function KeyHints({ hints, kind }: { hints: [GlyphButton, string][]; kind: PadKind }) {
  return (
    <div className="hints">
      {hints.map(([b, text]) => (
        <span key={b + text} className="hint">
          <Glyph button={b} kind={kind} />
          {text}
        </span>
      ))}
    </div>
  )
}
