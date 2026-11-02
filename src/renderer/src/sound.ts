/**
 * Original interface sounds, synthesized with Web Audio (no sound files, nothing borrowed).
 */
class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  enabled = true
  paused = false

  private get audio(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.enabled || this.paused) return null
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.35
      // soft room: short feedback delay
      const delay = this.ctx.createDelay()
      delay.delayTime.value = 0.09
      const fb = this.ctx.createGain()
      fb.gain.value = 0.22
      const wet = this.ctx.createGain()
      wet.gain.value = 0.25
      this.master.connect(this.ctx.destination)
      this.master.connect(delay)
      delay.connect(fb)
      fb.connect(delay)
      delay.connect(wet)
      wet.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return { ctx: this.ctx, out: this.master! }
  }

  private tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; vol?: number; to?: number } = {}): void {
    const a = this.audio
    if (!a) return
    const t = a.ctx.currentTime + start
    const o = a.ctx.createOscillator()
    const g = a.ctx.createGain()
    o.type = opts.type ?? 'sine'
    o.frequency.setValueAtTime(freq, t)
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(opts.vol ?? 0.3, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g)
    g.connect(a.out)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  move(): void {
    this.tone(1320, 0, 0.05, { vol: 0.12, type: 'triangle' })
  }
  column(): void {
    this.tone(990, 0, 0.07, { vol: 0.14, type: 'triangle' })
  }
  confirm(): void {
    this.tone(880, 0, 0.09, { vol: 0.2 })
    this.tone(1318.5, 0.06, 0.16, { vol: 0.18 })
  }
  back(): void {
    this.tone(1046.5, 0, 0.08, { vol: 0.16 })
    this.tone(698.5, 0.05, 0.14, { vol: 0.14 })
  }
  error(): void {
    this.tone(220, 0, 0.18, { vol: 0.22, type: 'square', to: 180 })
  }
  notify(): void {
    this.tone(1568, 0, 0.12, { vol: 0.12 })
    this.tone(2093, 0.08, 0.2, { vol: 0.1 })
  }
  launch(): void {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.07, 0.5, { vol: 0.14 }))
  }
  /** ~2.5 s boot chime: a rising shimmer that settles on a warm chord. */
  boot(): void {
    const chord = [261.63, 392.0, 523.25, 659.25, 783.99]
    chord.forEach((f, i) => this.tone(f, 0.15 + i * 0.12, 2.4 - i * 0.1, { vol: 0.09 }))
    ;[2093, 2637, 3136, 4186].forEach((f, i) => this.tone(f, 0.05 + i * 0.09, 0.6, { vol: 0.03 }))
    this.tone(130.81, 0.15, 2.6, { vol: 0.1, type: 'triangle' })
  }
}

export const sfx = new Sfx()
