/**
 * Bộ tạo âm thanh thư giãn bằng Web Audio API – không cần file âm thanh.
 * Mỗi kênh: noise buffer (lặp) → filter → (LFO tuỳ chọn) → gain → master.
 */
export type SoundId = 'white' | 'pink' | 'brown' | 'rain' | 'ocean' | 'wind'

export const SOUNDS: { id: SoundId; name: string; desc: string }[] = [
  { id: 'white', name: 'Ồn trắng', desc: 'Che tiếng ồn xung quanh' },
  { id: 'pink', name: 'Ồn hồng', desc: 'Mềm hơn, dễ ngủ' },
  { id: 'brown', name: 'Ồn nâu', desc: 'Trầm, ấm như tiếng máy bay' },
  { id: 'rain', name: 'Mưa', desc: 'Mưa rơi đều' },
  { id: 'ocean', name: 'Sóng biển', desc: 'Sóng vỗ chậm' },
  { id: 'wind', name: 'Gió rừng', desc: 'Gió thổi qua tán cây' },
]

export type AlarmSound = 'bell' | 'chime' | 'soft' | 'digital'
export const ALARM_SOUNDS: { id: AlarmSound; name: string }[] = [
  { id: 'bell', name: 'Chuông ting ting' },
  { id: 'chime', name: 'Chuỗi nốt nhạc' },
  { id: 'soft', name: 'Chuông nhẹ' },
  { id: 'digital', name: 'Bíp điện tử' },
]

type Color = 'white' | 'pink' | 'brown'

function makeBuffer(ctx: AudioContext, color: Color, seconds = 6) {
  const len = ctx.sampleRate * seconds
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (color === 'white') data[i] = w * 0.35
      else if (color === 'pink') {
        // Paul Kellet's refined pink noise
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.969 * b2 + w * 0.153852
        b3 = 0.8665 * b3 + w * 0.3104856
        b4 = 0.55 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.016898
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
        b6 = w * 0.115926
      } else {
        last = (last + 0.02 * w) / 1.02
        data[i] = last * 3.5
      }
    }
    // crossfade đầu/cuối để vòng lặp không bị "tách"
    const fade = Math.floor(ctx.sampleRate * 0.05)
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      data[i] = data[i] * t + data[len - fade + i] * (1 - t)
    }
  }
  return buf
}

interface Channel {
  src: AudioBufferSourceNode
  gain: GainNode
  extra: AudioNode[]
}

class NoiseEngine {
  ctx: AudioContext | null = null
  master: GainNode | null = null
  buffers = new Map<Color, AudioBuffer>()
  channels = new Map<SoundId, Channel>()

  private ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.8
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    return this.ctx
  }

  private buffer(color: Color) {
    const ctx = this.ensure()
    if (!this.buffers.has(color)) this.buffers.set(color, makeBuffer(ctx, color))
    return this.buffers.get(color)!
  }

  isPlaying(id: SoundId) {
    return this.channels.has(id)
  }

  play(id: SoundId, volume: number) {
    if (this.channels.has(id)) return
    const ctx = this.ensure()
    const color: Color = id === 'rain' ? 'white' : id === 'ocean' || id === 'brown' ? 'brown' : id === 'wind' ? 'pink' : (id as Color)
    const src = ctx.createBufferSource()
    src.buffer = this.buffer(color)
    src.loop = true
    const gain = ctx.createGain()
    gain.gain.value = 0
    const extra: AudioNode[] = []
    let node: AudioNode = src

    if (id === 'rain') {
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 900
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 7000
      node.connect(hp); hp.connect(lp); node = lp
      extra.push(hp, lp)
    } else if (id === 'ocean' || id === 'wind') {
      const f = ctx.createBiquadFilter()
      f.type = id === 'ocean' ? 'lowpass' : 'bandpass'
      f.frequency.value = id === 'ocean' ? 600 : 500
      f.Q.value = id === 'wind' ? 0.8 : 0.5
      const swell = ctx.createGain()
      swell.gain.value = 0.6
      const lfo = ctx.createOscillator()
      lfo.frequency.value = id === 'ocean' ? 0.09 : 0.05
      const lfoAmt = ctx.createGain()
      lfoAmt.gain.value = 0.4
      lfo.connect(lfoAmt); lfoAmt.connect(swell.gain)
      if (id === 'wind') {
        const fAmt = ctx.createGain()
        fAmt.gain.value = 300
        lfo.connect(fAmt); fAmt.connect(f.frequency)
        extra.push(fAmt)
      }
      lfo.start()
      node.connect(f); f.connect(swell); node = swell
      extra.push(f, swell, lfo, lfoAmt)
    }

    node.connect(gain)
    gain.connect(this.master!)
    src.start()
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.2)
    this.channels.set(id, { src, gain, extra })
  }

  stop(id: SoundId) {
    const ch = this.channels.get(id)
    if (!ch || !this.ctx) return
    const t = this.ctx.currentTime
    ch.gain.gain.cancelScheduledValues(t)
    ch.gain.gain.setValueAtTime(ch.gain.gain.value, t)
    ch.gain.gain.linearRampToValueAtTime(0, t + 0.6)
    this.channels.delete(id)
    setTimeout(() => {
      ch.src.stop()
      ch.extra.forEach((n) => { if (n instanceof OscillatorNode) n.stop(); n.disconnect() })
      ch.gain.disconnect()
    }, 700)
  }

  stopAll() {
    ;[...this.channels.keys()].forEach((id) => this.stop(id))
  }

  setVolume(id: SoundId, v: number) {
    const ch = this.channels.get(id)
    if (ch && this.ctx) ch.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1)
  }

  setMaster(v: number) {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1)
  }

  /** tiếng "ting" ngắn cho pomodoro và reminder (mặc định: chuông) */
  chime(sound: AlarmSound = 'bell') {
    const ctx = this.ensure()
    const note = (freq: number, at: number, type: OscillatorType, dur: number, peak: number) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = freq
      o.type = type
      const t = ctx.currentTime + at
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(peak, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t + dur)
      o.connect(g); g.connect(ctx.destination)
      o.start(t); o.stop(t + dur + 0.05)
    }
    if (sound === 'bell') { note(880, 0, 'sine', 1.2, 0.25); note(1320, 0.18, 'sine', 1.2, 0.25) }
    else if (sound === 'chime') { [523, 659, 784].forEach((f, i) => note(f, i * 0.22, 'triangle', 0.9, 0.22)) }
    else if (sound === 'soft') note(660, 0, 'sine', 2.2, 0.18)
    else { note(1000, 0, 'square', 0.12, 0.08); note(1000, 0.2, 'square', 0.12, 0.08) }
  }

  /** Reminder: kêu 1 lần, hoặc 3 lần (cách nhau 4 giây) nếu `repeat` bật */
  alarm(sound: AlarmSound, repeat: boolean) {
    this.chime(sound)
    if (!repeat) return
    ;[4000, 8000].forEach((ms) => setTimeout(() => this.chime(sound), ms))
  }
}

export const noise = new NoiseEngine()
