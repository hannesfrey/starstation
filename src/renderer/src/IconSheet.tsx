import { Icon, iconNames } from './components/Icons'
import { Glyph, type GlyphButton } from './components/Glyph'

/** Design check page (#icons): every button glyph and icon, large and small, on the menu background colour. */
const BUTTONS: GlyphButton[] = ['confirm', 'back', 'options', 'search', 'l1', 'r1', 'select', 'start']
const FIRST = /^(console-|3ds$|controller$)/

export function IconSheet() {
  const names = [...iconNames()].sort((a, b) => Number(!FIRST.test(a)) - Number(!FIRST.test(b)))
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto', background: 'linear-gradient(160deg,#16306b,#0a1736)', color: '#fff', padding: 28, font: '13px system-ui' }}>
      {(['playstation', 'xbox'] as const).map((kind) => (
        <div key={kind} className="hints" style={{ position: 'static', marginBottom: 18, flexWrap: 'wrap' }} data-glyphs={kind}>
          {BUTTONS.map((b) => (
            <span key={b} className="hint">
              <Glyph button={b} kind={kind} />
              {b}
            </span>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
        {names.map((n) => (
          <div key={n} data-icon={n} style={{ width: 120, textAlign: 'center', opacity: 0.95 }}>
            <Icon name={n} size={96} />
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'end' }}>
              <Icon name={n} size={48} />
              <Icon name={n} size={28} />
            </div>
            <div style={{ opacity: 0.7, marginTop: 4 }}>{n}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
