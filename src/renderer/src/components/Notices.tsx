import { useEffect } from 'react'
import type { Notice } from '../../../shared/types'
import { Icon } from './Icons'

const ICON: Record<Notice['kind'], string> = {
  info: 'info',
  success: 'favorite',
  warning: 'info',
  error: 'info',
  controller: 'controller',
  achievement: 'trophy',
  update: 'package',
  save: 'folder',
  mod: 'mod'
}

function NoticeItem({ n, onExpire }: { n: Notice; onExpire: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onExpire(n.id), n.kind === 'error' ? 8000 : 4500)
    return () => clearTimeout(t)
  }, [n.id, n.kind, onExpire])
  return (
    <div className={`notice ${n.kind}`}>
      <Icon name={ICON[n.kind]} size={28} />
      <div>
        <div className="notice-title">{n.title}</div>
        {n.detail && <div className="notice-detail">{n.detail}</div>}
      </div>
    </div>
  )
}

export function Notices({ list, onExpire }: { list: Notice[]; onExpire: (id: number) => void }) {
  return (
    <div className="notices" data-testid="notices">
      {list.slice(-4).map((n) => (
        <NoticeItem key={n.id} n={n} onExpire={onExpire} />
      ))}
    </div>
  )
}
