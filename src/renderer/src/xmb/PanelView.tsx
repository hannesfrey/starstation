import type { Panel } from './panels'
import { api } from '../api'

export function PanelView({ panel, index, onSelect, onRun, wizard }: { panel: Panel; index: number; onSelect: (i: number) => void; onRun: () => void; wizard?: boolean }) {
  return (
    <div className={`panel ${wizard ? 'wizard' : ''}`} data-testid={`panel-${panel.id}`}>
      <div className="panel-title">{panel.title}</div>
      {panel.image && <img className="panel-image" src={panel.image.startsWith('https://') ? panel.image : api.mediaUrl(panel.image)} alt="" />}
      <div className="panel-items">
        {panel.items.map((it, i) => (
          <div
            key={it.key}
            data-testid={`pitem-${it.key}`}
            className={`panel-item ${i === index ? 'active' : ''} ${it.info ? 'info' : ''} ${it.disabled ? 'disabled' : ''}`}
            onClick={() => onSelect(i)}
            onDoubleClick={() => {
              onSelect(i)
              onRun()
            }}
          >
            <span className="panel-label">{it.label}</span>
            {it.value !== undefined && <span className="panel-value">{it.value}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
