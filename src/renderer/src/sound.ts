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

/**
 * Original background music: a slow, generated ambient pad (four soft chords that drift, with a few
 * high notes on top). Off by default; paused while a game runs and during the screensaver.
 */
class Music {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private timer: number | null = null
  private step = 0
  playing = false

  // Fmaj9 – Dm9 – Bbmaj7 – C6/9 (in Hz), voiced low and wide
  private chords = [
    [87.31, 130.81, 174.61, 220.0, 261.63, 392.0],
    [73.42, 110.0, 146.83, 174.61, 220.0, 329.63],
    [58.27, 116.54, 146.83, 174.61, 220.0, 293.66],
    [65.41, 98.0, 146.83, 164.81, 220.0, 293.66]
  ]

  start(): void {
    if (this.playing) return
    this.playing = true
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.out = this.ctx.createGain()
      this.out.gain.value = 0
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 1400
      this.out.connect(lp)
      lp.connect(this.ctx.destination)
    }
    void this.ctx.resume()
    const t = this.ctx.currentTime
    this.out!.gain.cancelScheduledValues(t)
    this.out!.gain.setValueAtTime(this.out!.gain.value, t)
    this.out!.gain.linearRampToValueAtTime(0.05, t + 3)
    this.play()
    this.timer = window.setInterval(() => this.play(), 8000)
  }

  stop(): void {
    if (!this.playing || !this.ctx || !this.out) return
    this.playing = false
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    const t = this.ctx.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setValueAtTime(this.out.gain.value, t)
    this.out.gain.linearRampToValueAtTime(0, t + 1.5)
  }

  private play(): void {
    const ctx = this.ctx!
    const chord = this.chords[this.step++ % this.chords.length]
    const t = ctx.currentTime + 0.05
    for (const [i, f] of chord.entries()) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = i === 0 ? 'triangle' : 'sine'
        o.frequency.value = f
        o.detune.value = detune
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(i === 0 ? 0.5 : 0.22, t + 3)
        g.gain.linearRampToValueAtTime(0, t + 9.5)
        o.connect(g)
        g.connect(this.out!)
        o.start(t)
        o.stop(t + 10)
      }
    }
    // a couple of quiet bell notes from the chord, an octave up
    for (let k = 0; k < 2; k++) {
      const f = chord[2 + Math.floor(Math.random() * 4)] * 2
      const at = t + 1.5 + k * 2.5 + Math.random()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.12, at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3)
      o.connect(g)
      g.connect(this.out!)
      o.start(at)
      o.stop(at + 3.1)
    }
  }
}

export const music = new Music()
