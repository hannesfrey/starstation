import type { PadKind } from '../input'

export type GlyphButton = 'confirm' | 'back' | 'options' | 'search' | 'start' | 'select' | 'l1' | 'r1'

const PS: Record<GlyphButton, string> = {
  confirm: '✕',
  back: '○',
  options: '△',
  search: '□',
  start: 'START',
  select: 'SELECT',
  l1: 'L1',
  r1: 'R1'
}
const XB: Record<GlyphButton, string> = {
  confirm: 'A',
  back: 'B',
  options: 'Y',
  search: 'X',
  start: 'MENU',
  select: 'VIEW',
  l1: 'LB',
  r1: 'RB'
}
const XB_COLORS: Partial<Record<GlyphButton, string>> = { confirm: '#5cb85c', back: '#d9534f', options: '#f0ad4e', search: '#4a90d9' }
const PS_COLORS: Partial<Record<GlyphButton, string>> = { confirm: '#8fb3ff', back: '#ff8a8a', options: '#7fe0c0', search: '#f2a6e0' }

export function Glyph({ button, kind }: { button: GlyphButton; kind: PadKind }) {
  const xbox = kind === 'xbox'
  const label = (xbox ? XB : PS)[button]
  const color = (xbox ? XB_COLORS : PS_COLORS)[button]
  const round = label.length <= 1
  return (
    <span className={`glyph ${round ? 'round' : 'pill'} ${xbox ? 'xbox' : 'ps'}`} style={color ? { color } : undefined}>
      {label}
    </span>
  )
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
