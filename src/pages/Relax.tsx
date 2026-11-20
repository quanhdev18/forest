import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Pause, Play, RotateCcw, Square, Volume2 } from 'lucide-react'
import { noise, SOUNDS, SoundId } from '../lib/noise'
import { useToasts } from '../components/ui'
import { SpotifyPanel } from '../components/SpotifyPanel'
import { cx } from '../lib/utils'

/** trạng thái âm thanh dùng chung – nhạc vẫn chạy khi chuyển trang */
interface RelaxState {
  playing: Partial<Record<SoundId, true>>
  volume: Record<SoundId, number>
  master: number
  toggle: (id: SoundId) => void
  setVol: (id: SoundId, v: number) => void
  setMaster: (v: number) => void
  stopAll: () => void
}
export const useRelax = create<RelaxState>((set, get) => ({
  playing: {},
  volume: { white: 0.5, pink: 0.5, brown: 0.6, rain: 0.5, ocean: 0.7, wind: 0.6 },
  master: 0.8,
  toggle: (id) => {
    const playing = { ...get().playing }
    if (playing[id]) { noise.stop(id); delete playing[id] }
    else { noise.play(id, get().volume[id]); playing[id] = true }
    set({ playing })
  },
  setVol: (id, v) => { noise.setVolume(id, v); set({ volume: { ...get().volume, [id]: v } }) },
  setMaster: (v) => { noise.setMaster(v); set({ master: v }) },
  stopAll: () => { noise.stopAll(); set({ playing: {} }) },
}))

/** Pomodoro – cũng là module-level để không reset khi đổi trang */
interface Pomo { mode: 'focus' | 'break'; left: number; running: boolean; endAt: number | null; rounds: number }
const FOCUS = 25 * 60, BREAK = 5 * 60
export const usePomo = create<Pomo & { start: () => void; pause: () => void; reset: (m?: Pomo['mode']) => void; tick: () => void }>((set, get) => ({
  mode: 'focus', left: FOCUS, running: false, endAt: null, rounds: 0,
  start: () => set({ running: true, endAt: Date.now() + get().left * 1000 }),
  pause: () => set({ running: false, endAt: null }),
  reset: (m = get().mode) => set({ mode: m, left: m === 'focus' ? FOCUS : BREAK, running: false, endAt: null }),
  tick: () => {
    const s = get()
    if (!s.running || !s.endAt) return
    const left = Math.max(0, Math.round((s.endAt - Date.now()) / 1000))
    if (left > 0) return set({ left })
    noise.chime()
    const next = s.mode === 'focus' ? 'break' : 'focus'
    useToasts.getState().push(next === 'break' ? 'Hết phiên tập trung – nghỉ 5 phút nhé 🌿' : 'Hết giờ nghỉ – quay lại làm việc!')
    set({ mode: next, left: next === 'focus' ? FOCUS : BREAK, running: false, endAt: null, rounds: s.rounds + (s.mode === 'focus' ? 1 : 0) })
  },
}))
setInterval(() => usePomo.getState().tick(), 500)

export default function Relax() {
  const r = useRelax()
  const p = usePomo()
  const [, force] = useState(0)
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  const mm = String(Math.floor(p.left / 60)).padStart(2, '0')
  const ss = String(p.left % 60).padStart(2, '0')
  const anyPlaying = Object.keys(r.playing).length > 0

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Thư giãn</h1>
        <div className="row">
          <Volume2 size={18} />
          <input type="range" min={0} max={1} step={0.01} value={r.master} onChange={(e) => r.setMaster(+e.target.value)} style={{ accentColor: 'var(--black)' }} aria-label="Âm lượng tổng" />
          {anyPlaying && <button className="btn" onClick={r.stopAll}><Square size={14} /> Tắt hết</button>}
        </div>
      </div>
      <div className="dash">
        <div style={{ gridColumn: 'span 8' }}>
          <p className="muted" style={{ marginTop: 0 }}>Bật nhiều âm cùng lúc để tự trộn. Âm thanh vẫn phát khi bạn chuyển sang trang khác.</p>
          <div className="sounds">
            {SOUNDS.map((s) => {
              const on = !!r.playing[s.id]
              return (
                <div key={s.id} className={cx('glass sound', on && 'on')} onClick={() => r.toggle(s.id)}>
                  <div className="row">
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div className="small muted">{s.desc}</div>
                    </div>
                    {on ? <Pause size={20} /> : <Play size={20} />}
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.01} value={r.volume[s.id]}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => r.setVol(s.id, +e.target.value)}
                    aria-label={`Âm lượng ${s.name}`}
                  />
                </div>
              )
            })}
          </div>
        </div>
        <div className="glass panel" style={{ gridColumn: 'span 4', textAlign: 'center' }}>
          <div className="seg">
            <button className={p.mode === 'focus' ? 'on' : ''} onClick={() => p.reset('focus')}>Tập trung 25'</button>
            <button className={p.mode === 'break' ? 'on' : ''} onClick={() => p.reset('break')}>Nghỉ 5'</button>
          </div>
          <div className="timer">{mm}:{ss}</div>
          <div className="row" style={{ justifyContent: 'center' }}>
            {p.running
              ? <button className="btn dark" onClick={p.pause}><Pause size={15} /> Tạm dừng</button>
              : <button className="btn dark" onClick={() => { p.start(); if (!anyPlaying) r.toggle('rain') }}><Play size={15} /> Bắt đầu</button>}
            <button className="btn" onClick={() => p.reset()}><RotateCcw size={15} /></button>
          </div>
          <p className="small muted">Đã hoàn thành {p.rounds} phiên hôm nay</p>
        </div>
        <div style={{ gridColumn: 'span 12' }}>
          <SpotifyPanel />
        </div>
      </div>
    </>
  )
}
