import { api } from '../api'
import { Icon } from './Icons'

/** Controller-friendly on-screen keyboard (search, collection names). */

export const KEY_ROWS: string[][] = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'],
  ['U', 'V', 'W', 'X', 'Y', 'Z', '1', '2', '3', '4'],
  ['5', '6', '7', '8', '9', '0', '-', "'", '&', '.'],
  ['SPACE', 'DELETE', 'DONE']
]

export interface EntryResult {
  key: string
  label: string
  sub: string
  icon: string
  art?: string
}

export interface EntryState {
  kind: 'search' | 'new-collection' | 'rename-collection'
  title: string
  value: string
  row: number
  col: number
  focus: 'keys' | 'results'
  result: number
  /** Game to add to the new collection / collection to rename. */
  target?: string
}

export function clampCol(row: number, col: number): number {
  return Math.max(0, Math.min(KEY_ROWS[row].length - 1, col))
}

export function TextEntry(p: {
  entry: EntryState
  results?: EntryResult[]
  onKey: (row: number, col: number) => void
  onResult: (i: number) => void
  onResultActivate: (i: number) => void
}) {
  const { entry: e, results } = p
  const list = results ?? []
  // keep the selected result in view: show a window of 8
  const start = Math.max(0, Math.min(e.result - 3, list.length - 8))
  return (
    <div className={`entry ${results ? 'with-results' : ''}`} data-testid={`entry-${e.kind}`}>
      <div className="entry-title">{e.title}</div>
      <div className="entry-box" data-testid="entry-value">
        {e.kind === 'search' && <Icon name="search" size={28} />}
        <span>{e.value}</span>
        <span className="entry-caret" />
      </div>
      <div className="entry-body">
        <div className={`entry-keys ${e.focus === 'keys' ? 'focused' : ''}`}>
          {KEY_ROWS.map((row, r) => (
            <div className="entry-row" key={r}>
              {row.map((k, c) => (
                <div
                  key={k}
                  data-testid={`key-${k}`}
                  className={`entry-key ${k.length > 1 ? 'wide' : ''} ${e.focus === 'keys' && e.row === r && e.col === c ? 'active' : ''}`}
                  onClick={() => p.onKey(r, c)}
                >
                  {k === 'SPACE' ? 'Space' : k === 'DELETE' ? 'Delete' : k === 'DONE' ? 'Done' : k}
                </div>
              ))}
            </div>
          ))}
        </div>
        {results && (
          <div className={`entry-results ${e.focus === 'results' ? 'focused' : ''}`} data-testid="entry-results">
            {list.length === 0 && <div className="entry-none">{e.value.trim() ? 'No games found.' : 'Type to search all consoles.'}</div>}
            {list.slice(start, start + 8).map((r, k) => {
              const i = start + k
              return (
                <div
                  key={r.key}
                  data-testid={`result-${r.key}`}
                  className={`entry-result ${e.focus === 'results' && i === e.result ? 'active' : ''}`}
                  onClick={() => p.onResult(i)}
                  onDoubleClick={() => p.onResultActivate(i)}
                >
                  <div className="entry-result-icon">{r.art ? <img src={api.mediaUrl(r.art)} alt="" /> : <Icon name={r.icon} size={36} />}</div>
                  <div>
                    <div className="entry-result-label">{r.label}</div>
                    <div className="entry-result-sub">{r.sub}</div>
                  </div>
                </div>
              )
            })}
            {list.length > 8 && <div className="entry-more">{list.length} games</div>}
          </div>
        )}
      </div>
    </div>
  )
}
