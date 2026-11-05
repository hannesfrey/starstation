import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api } from '../api'
import { input } from '../input'
import { sfx } from '../sound'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Game manual (scanned booklet from ScreenScraper), page by page with the controller (SPEC-v2 D).
 * ← → or L1 / R1: page · ✕: zoom in / out · ↑ ↓: scroll when zoomed · ○: close.
 */
export function ManualViewer({ file, title, onClose }: { file: string; title: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let gone = false
    let task: pdfjs.PDFDocumentLoadingTask | null = null
    // the bytes come from Starstation itself (the page may not fetch local files)
    void api.readMedia(file).then((data) => {
      if (gone) return
      if (!data) return setError('This manual could not be opened.')
      task = pdfjs.getDocument({ data })
      task.promise.then(
      (d) => !gone && setDoc(d),
      (e) => {
        console.error('manual', e)
        if (!gone) setError('This manual could not be opened.')
      }
      )
    })
    return () => {
      gone = true
      void task?.destroy()
    }
  }, [file])

  // draw the page: fit the height of the screen, or the width when zoomed in
  useEffect(() => {
    if (!doc || !canvas.current || !box.current) return
    let cancelled = false
    let render: pdfjs.RenderTask | null = null
    void doc.getPage(page).then((p) => {
      if (cancelled || !canvas.current || !box.current) return
      const base = p.getViewport({ scale: 1 })
      const w = box.current.clientWidth
      const h = box.current.clientHeight
      const scale = (zoom ? w / base.width : Math.min(w / base.width, h / base.height)) * window.devicePixelRatio
      const vp = p.getViewport({ scale })
      const c = canvas.current
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      c.style.width = `${Math.floor(vp.width / window.devicePixelRatio)}px`
      c.style.height = `${Math.floor(vp.height / window.devicePixelRatio)}px`
      render = p.render({ canvas: c, viewport: vp })
      box.current.scrollTop = 0
    })
    return () => {
      cancelled = true
      render?.cancel()
    }
  }, [doc, page, zoom])

  useEffect(
    () =>
      input.on((a) => {
        const n = doc?.numPages ?? 1
        if (a === 'right' || a === 'r1') {
          if (page < n) {
            setPage(page + 1)
            sfx.move()
          }
        } else if (a === 'left' || a === 'l1') {
          if (page > 1) {
            setPage(page - 1)
            sfx.move()
          }
        } else if (a === 'confirm') {
          setZoom((z) => !z)
          sfx.confirm()
        } else if ((a === 'up' || a === 'down') && box.current) box.current.scrollBy({ top: (a === 'up' ? -1 : 1) * box.current.clientHeight * 0.4, behavior: 'smooth' })
        else if (a === 'back') {
          sfx.back()
          onClose()
        }
      }),
    [doc, page, onClose]
  )

  return (
    <div className="manual" data-testid="manual">
      <div className="manual-top">
        <span>{title} · Manual</span>
        <span data-testid="manual-page">{doc ? `Page ${page} / ${doc.numPages}` : error ?? 'Opening…'}</span>
      </div>
      <div className={`manual-page ${zoom ? 'zoom' : ''}`} ref={box}>
        <canvas ref={canvas} />
      </div>
      <div className="manual-hint">← → page · ✕ zoom · ○ close</div>
    </div>
  )
}
