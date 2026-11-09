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

/** Fixed colour themes (Settings → Theme & display); "monthly" follows the month, "starvis" is a night sky. */
export const THEMES: Record<string, { label: string; color?: [number, number, number] }> = {
  monthly: { label: 'Changes every month' },
  blue: { label: 'Blue', color: [50, 110, 200] },
  teal: { label: 'Teal', color: [40, 160, 170] },
  green: { label: 'Green', color: [70, 160, 90] },
  gold: { label: 'Gold', color: [178, 150, 60] },
  red: { label: 'Red', color: [175, 45, 55] },
  violet: { label: 'Violet', color: [130, 90, 190] },
  black: { label: 'Black', color: [44, 46, 54] },
  starvis: { label: 'Starvis (night sky)', color: [26, 34, 82] }
}

/** A fixed sky of stars for the Starvis theme (same every start). */
const STARS = Array.from({ length: 220 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1
  return { x: r(1), y: r(2) * 0.85, size: 0.4 + r(3) * 1.4, phase: r(4) * Math.PI * 2, speed: 0.3 + r(5) * 0.9 }
})

/** Darker at night, brightest around midday. */
function dayFactor(d = new Date()): number {
  const h = d.getHours() + d.getMinutes() / 60
  return 0.55 + 0.45 * Math.max(0, Math.cos(((h - 13) / 12) * Math.PI))
}

interface Props {
  paused: boolean
  dim: boolean
  /** Settings → Theme ("monthly" if not set). */
  theme?: string
  /** #33 Reduced animations: drawn twice a second instead of every frame. */
  reduced?: boolean
}

export function Background({ paused, dim, theme = 'monthly', reduced = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pausedRef = useRef(paused)
  const dimRef = useRef(dim)
  const themeRef = useRef(theme)
  const reducedRef = useRef(reduced)
  const wakeRef = useRef<() => void>(() => undefined)
  pausedRef.current = paused
  dimRef.current = dim
  themeRef.current = theme
  reducedRef.current = reduced
  // #33 paused (a game runs) or the window hidden: no frames at all; they start again when it's back
  useEffect(() => {
    if (!paused) wakeRef.current()
  }, [paused, reduced])
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) wakeRef.current()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

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

    let slow = 0
    const schedule = () => {
      if (raf || slow) return
      if (reducedRef.current) slow = window.setTimeout(() => ((slow = 0), draw(performance.now())), 500)
      else raf = requestAnimationFrame((n) => ((raf = 0), draw(n)))
    }
    wakeRef.current = () => {
      last = performance.now()
      schedule()
    }
    const draw = (now: number) => {
      // stop while paused or hidden: nothing is scheduled until wakeRef is called
      if (pausedRef.current || document.hidden) return
      schedule()
      const dt = Math.min(reducedRef.current ? 600 : 100, now - last)
      last = now
      t += (dt / 1000) * (dimRef.current ? 0.25 : 1)
      const w = canvas.width
      const h = canvas.height
      const starvis = themeRef.current === 'starvis'
      const [r, g, b] = THEMES[themeRef.current]?.color ?? monthColor()
      const k = (starvis ? 1 : dayFactor()) * (dimRef.current ? 0.35 : 1)

      const bg = ctx.createLinearGradient(0, 0, w * 0.3, h)
      bg.addColorStop(0, `rgb(${(r * k) | 0},${(g * k) | 0},${(b * k) | 0})`)
      bg.addColorStop(0.55, `rgb(${(r * k * 0.45) | 0},${(g * k * 0.45) | 0},${(b * k * 0.45) | 0})`)
      bg.addColorStop(1, `rgb(${(r * k * 0.12) | 0},${(g * k * 0.12) | 0},${(b * k * 0.12) | 0})`)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      // Starvis: a quiet night sky — twinkling stars over the gradient
      if (starvis) {
        ctx.globalCompositeOperation = 'lighter'
        for (const s of STARS) {
          const a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase))) * (dimRef.current ? 0.4 : 1)
          ctx.fillStyle = `rgba(235,240,255,${a.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(s.x * w, s.y * h, s.size * (w / 1600), 0, Math.PI * 2)
          ctx.fill()
        }
      }

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
    schedule()
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(slow)
      wakeRef.current = () => undefined
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="bg-canvas" aria-hidden />
}
