import { api } from '../api'
import type { Screenshot } from '../../../shared/types'

/** Full-screen screenshot viewer for the Photo column (← → browse, ○ close). */
export function PhotoViewer({ shots, index }: { shots: Screenshot[]; index: number }) {
  const s = shots[index]
  if (!s) return null
  const when = new Date(s.takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <div className="photo-viewer" data-testid="photo-viewer">
      <img src={api.mediaUrl(s.path)} alt="" />
      <div className="photo-caption">
        <span className="photo-title">{s.title || 'Screenshot'}</span>
        <span className="photo-meta">
          {s.consoleName ? `${s.consoleName} · ` : ''}
          {when} · {index + 1} / {shots.length}
        </span>
      </div>
    </div>
  )
}
