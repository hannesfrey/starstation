import { api } from '../api'
import { Icon } from '../components/Icons'
import type { XColumn, XItem } from './model'
import type { GameStats } from '../../../shared/types'
import { formatPlayTime } from './model'

interface Props {
  columns: XColumn[]
  col: number
  items: XItem[]
  row: number
  folderTitle: string | null
  emptyText?: string
  stats: Record<string, GameStats>
  onSelectColumn: (i: number) => void
  onSelectRow: (i: number) => void
  onActivate: () => void
  /** i: the row that was right-clicked (its menu, even before the selection has moved there). */
  onOptions: (i?: number) => void
}

/** Category spacing and item height, in viewport-relative units (see styles.css). */
const CAT_GAP_VW = 10.5
const ITEM_H_VH = 9.2

export function Xmb(p: Props) {
  const sel = p.items[p.row]
  return (
    <div className="xmb" data-testid="xmb">
      <div className="xmb-cats">
        {p.columns.map((c, i) => {
          const d = i - p.col
          return (
            <div
              key={c.id}
              data-testid={`cat-${c.id}`}
              className={`xmb-cat ${d === 0 ? 'active' : ''}`}
              style={{ transform: `translateX(${d * CAT_GAP_VW}vw)`, opacity: Math.abs(d) > 7 ? 0 : 1 }}
              onClick={() => p.onSelectColumn(i)}
            >
              <Icon name={c.icon} size={d === 0 ? 72 : 56} />
              <div className="xmb-cat-label">{d === 0 ? (p.folderTitle ?? c.label) : c.label}</div>
            </div>
          )
        })}
      </div>

      <div className={`xmb-items ${p.folderTitle ? 'in-folder' : ''}`} data-testid="items">
        {p.items.map((it, i) => {
          const d = i - p.row
          // items before the selection sit above the category row, the rest below it
          const y = d < 0 ? -ITEM_H_VH * 0.9 * -d - 17 : d === 0 ? 0 : ITEM_H_VH * d + 1.5
          if (d < -4 || d > 9) return null
          return (
            <div
              key={it.key}
              data-testid={`item-${it.key}`}
              className={`xmb-item ${d === 0 ? 'active' : ''} ${d < 0 ? 'above' : ''}`}
              style={{ transform: `translateY(${y}vh)` }}
              onClick={() => p.onSelectRow(i)}
              onDoubleClick={() => {
                p.onSelectRow(i)
                p.onActivate()
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                p.onSelectRow(i)
                p.onOptions(i)
              }}
            >
              <div className="xmb-item-icon">
                {it.art ? <img src={api.mediaUrl(it.art)} alt="" draggable={false} /> : <Icon name={it.icon} size={d === 0 ? 60 : 48} />}
              </div>
              <div className="xmb-item-text">
                <div className="xmb-item-label">{it.label}</div>
                {it.sub && d === 0 && <div className="xmb-item-sub">{it.sub}</div>}
              </div>
            </div>
          )
        })}
        {p.items.length === 0 && <div className="xmb-empty">{p.emptyText ?? 'Nothing here yet.'}</div>}
      </div>

      {sel?.game && <GameInfo item={sel} stats={p.stats[sel.game.id]} />}
    </div>
  )
}

function GameInfo({ item, stats }: { item: XItem; stats?: GameStats }) {
  const g = item.game!
  const facts = [g.year, g.genre, g.players ? `${g.players} player${g.players > 1 ? 's' : ''}` : null].filter(Boolean)
  return (
    <div className="game-info" data-testid="game-info">
      <div className="game-info-title">{g.title}</div>
      {facts.length > 0 && <div className="game-info-facts">{facts.join(' · ')}</div>}
      <div className="game-info-play">{formatPlayTime(stats?.playTime ?? 0)}</div>
      {stats?.favorite && <div className="game-info-fav">★ Favorite</div>}
    </div>
  )
}
