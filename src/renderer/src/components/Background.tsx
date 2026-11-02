import { useEffect, useRef } from 'react'

/** Base hue per month (Jan..Dec). Our own palette, shifting through the year. */
const MONTH_COLORS: [number, number, number][] = [
  [178, 150, 60], // Jan  warm gold
  [150, 170, 70], // Feb  spring lime
  [70, 160, 90], // Mar  green
  [200, 110, 150], // Apr  blossom pink
  [80, 165, 120], // May  fresh green
  [130, 90, 190], // Jun  violet
  [40, 160, 170], // Jul  teal
  [50, 110, 200], // Aug  deep blue
  [120, 80, 180], // Sep  purple
  [190, 110, 50], // Oct  amber
  [140, 95, 70], // Nov  chestnut
  [175, 45, 55] // Dec  winter red
]

export function monthColor(d = new Date()): [number, number, number] {
  return MONTH_COLORS[d.getMonth()]
}

/** Darker at night, brightest around midday. */
function dayFactor(d = new Date()): number {
  const h = d.getHours() + d.getMinutes() / 60
  return 0.55 + 0.45 * Math.max(0, Math.cos(((h - 13) / 12) * Math.PI))
}

interface Props {
  paused: boolean
  dim: boolean
}

export function Background({ paused, dim }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pausedRef = useRef(paused)
  const dimRef = useRef(dim)
  pausedRef.current = paused
  dimRef.current = dim

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let t = 0
    let last = performance.now()

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dt = Math.min(100, now - last)
      last = now
      if (pausedRef.current) return
      t += (dt / 1000) * (dimRef.current ? 0.25 : 1)
      const w = canvas.width
      const h = canvas.height
      const [r, g, b] = monthColor()
      const k = dayFactor() * (dimRef.current ? 0.35 : 1)

      const bg = ctx.createLinearGradient(0, 0, w * 0.3, h)
      bg.addColorStop(0, `rgb(${(r * k) | 0},${(g * k) | 0},${(b * k) | 0})`)
      bg.addColorStop(0.55, `rgb(${(r * k * 0.45) | 0},${(g * k * 0.45) | 0},${(b * k * 0.45) | 0})`)
      bg.addColorStop(1, `rgb(${(r * k * 0.12) | 0},${(g * k * 0.12) | 0},${(b * k * 0.12) | 0})`)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      // flowing ribbons
      ctx.globalCompositeOperation = 'lighter'
      const ribbons = 7
      for (let i = 0; i < ribbons; i++) {
        const phase = i * 0.55
        const amp = h * (0.05 + 0.02 * Math.sin(t * 0.13 + i))
        const base = h * (0.56 + 0.025 * (i - ribbons / 2))
        const alpha = (0.05 + 0.035 * Math.sin(t * 0.2 + i * 1.3) + 0.04) * (dimRef.current ? 0.5 : 1)
        ctx.beginPath()
        for (let x = 0; x <= w; x += 8) {
          const nx = x / w
          const y =
            base +
            Math.sin(nx * 3.1 + t * 0.35 + phase) * amp +
            Math.sin(nx * 7.3 - t * 0.22 + phase * 1.7) * amp * 0.35 +
            Math.cos(nx * 1.3 + t * 0.12) * amp * 0.6
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = `rgba(255,255,255,${Math.max(0.01, alpha)})`
        ctx.lineWidth = (1.2 + (i % 3)) * (w / 1600)
        ctx.stroke()
      }
      // soft glow band
      const glow = ctx.createLinearGradient(0, h * 0.42, 0, h * 0.72)
      glow.addColorStop(0, 'rgba(255,255,255,0)')
      glow.addColorStop(0.5, `rgba(255,255,255,${dimRef.current ? 0.01 : 0.035})`)
      glow.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, h * 0.42, w, h * 0.3)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="bg-canvas" aria-hidden />
}
