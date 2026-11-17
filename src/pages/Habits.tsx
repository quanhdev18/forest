import { useState } from 'react'
import { addDays, isToday } from 'date-fns'
import { Check, Flame, Plus, Trash2 } from 'lucide-react'
import { Habit, useStore } from '../store'
import { cx, dkey, fmt } from '../lib/utils'

const COLORS = ['#6b1a24', '#1d1d1f', '#5d7f93', '#3f7d4f', '#b7791f', '#7b4fa0']

export function streak(h: Habit) {
  let n = 0
  let d = new Date()
  if (!h.log[dkey(d)]) d = addDays(d, -1) // hôm nay chưa tick vẫn giữ chuỗi
  while (h.log[dkey(d)]) { n++; d = addDays(d, -1) }
  return n
}

export default function Habits() {
  const { habits, upsertHabit, toggleHabit, removeHabit } = useStore()
  const [name, setName] = useState('')
  const [range, setRange] = useState<7 | 30>(7)
  const days = Array.from({ length: range }, (_, i) => addDays(new Date(), i - range + 1))

  const add = () => {
    if (!name.trim()) return
    upsertHabit({ name: name.trim(), color: COLORS[habits.length % COLORS.length] })
    setName('')
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Thói quen</h1>
        <div className="seg">
          <button className={range === 7 ? 'on' : ''} onClick={() => setRange(7)}>7 ngày</button>
          <button className={range === 30 ? 'on' : ''} onClick={() => setRange(30)}>30 ngày</button>
        </div>
      </div>
      <div className="glass panel" style={{ overflowX: 'auto' }}>
        <div className="habit-grid" style={{ gridTemplateColumns: `220px repeat(${range}, 30px) 80px 34px` }}>
          <div />
          {days.map((d) => (
            <div key={+d} className="small muted" style={{ textAlign: 'center', fontSize: 10 }}>
              {range === 7 ? fmt(d, 'EEEEEE') : ''}<br />{d.getDate()}
            </div>
          ))}
          <div className="small muted" style={{ textAlign: 'center' }}>Chuỗi</div>
          <div />
          {habits.map((h) => {
            const s = streak(h)
            return (
              <div key={h.id} style={{ display: 'contents' }}>
                <div className="row" style={{ fontWeight: 600 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: h.color }} /> {h.name}
                </div>
                {days.map((d) => {
                  const k = dkey(d)
                  const on = !!h.log[k]
                  return (
                    <button
                      key={k}
                      className={cx('hcell', on && 'on', isToday(d) && 'today')}
                      style={{ background: on ? h.color : undefined }}
                      onClick={() => toggleHabit(h.id, k)}
                      title={fmt(d, 'dd/MM')}
                    >
                      {on && <Check size={14} />}
                    </button>
                  )
                })}
                <div style={{ textAlign: 'center', fontWeight: 700 }}>
                  {s > 0 ? <><Flame size={14} color="#e2711d" style={{ verticalAlign: -2 }} /> {s}</> : <span className="muted">–</span>}
                </div>
                <button className="icon-btn" onClick={() => confirm(`Xoá thói quen "${h.name}"?`) && removeHabit(h.id)} aria-label="Xoá">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="row" style={{ marginTop: 16, maxWidth: 420 }}>
          <input className="input" placeholder="Thói quen mới, VD: Ngủ trước 23h" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn dark" onClick={add}><Plus size={15} /> Thêm</button>
        </div>
      </div>
    </>
  )
}
