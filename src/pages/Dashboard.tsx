import { useState } from 'react'
import { addDays } from 'date-fns'
import { AlertTriangle, BellRing, CalendarDays, Check, Coins, Headphones, Flame, Play, Pause } from 'lucide-react'
import { useStore } from '../store'
import { refreshFx, useFxStatus } from '../lib/fx'
import { streak } from './Habits'
import { whenLabel } from './Reminders'
import { useRelax } from './Relax'
import { useSync } from '../lib/sync'
import { cx, dkey, fmt, money } from '../lib/utils'

const go = (r: string) => (location.hash = '#/' + r)

/** Quy đổi USD → VND theo tỷ giá thế giới lấy tự động (không chỉnh tay) */
function FxPanel() {
  const fx = useStore((s) => s.fx)
  const { loading, error } = useFxStatus()
  const [usd, setUsd] = useState('100')
  const amount = Number(usd.replace(',', '.')) || 0
  const hasRate = fx.usdVnd > 0

  return (
    <div className="glass panel" style={{ gridColumn: 'span 4' }}>
      <h3><Coins size={18} /> Tỷ giá USD → VND</h3>
      <div className="small muted" style={{ marginTop: -6 }}>
        {hasRate ? (
          <>1 USD = {money(Math.round(fx.usdVnd))}</>
        ) : (
          <>{error ? 'Chưa lấy được tỷ giá' : 'Đang lấy tỷ giá…'}</>
        )}
        {fx.updatedAt && <> · nguồn cập nhật {fmt(new Date(fx.updatedAt), 'HH:mm dd/MM')}</>}
      </div>
      {error && <div className="small" style={{ color: 'var(--wine)', marginTop: 4 }}>Lỗi: {error}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost" onClick={() => void refreshFx()} disabled={loading}>
          {loading ? 'Đang tải…' : 'Làm mới tỷ giá'}
        </button>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <input
          className="grow"
          inputMode="decimal"
          value={usd}
          onChange={(e) => setUsd(e.target.value)}
          aria-label="Số USD"
        />
        <span className="small muted">USD</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>
        = {hasRate ? money(Math.round(amount * fx.usdVnd)) : '—'}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { items, reminders, habits, transactions, toggleHabit, upsertReminder } = useStore()
  const relax = useRelax()
  const today = dkey(new Date())
  const in7 = dkey(addDays(new Date(), 7))
  const live = items.filter((i) => !i.archived)

  const todayItems = live.filter((i) => i.date === today)
  const deadlines = live
    .filter((i) => i.kind === 'booking' && i.deadline && i.status !== 'posted' && i.deadline <= in7)
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!))
  const upcoming = reminders.filter((r) => !r.done && r.firedAt !== r.at).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 5)
  const mk = today.slice(0, 7)
  const monthTx = transactions.filter((t) => t.date.startsWith(mk))
  const inc = monthTx.filter((t) => t.type === 'in').reduce((s, t) => s + t.amount, 0)
  const out = monthTx.filter((t) => t.type === 'out').reduce((s, t) => s + t.amount, 0)
  const hour = new Date().getHours()
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
  const rainOn = !!relax.playing.rain
  const name = useSync((s) => s.name)

  return (
    <>
      <h1 className="page-title">{greet}{name ? `, ${name}` : ''} 🌲</h1>
      <p className="muted" style={{ marginTop: -10, marginBottom: 20 }}>{fmt(new Date(), "EEEE, 'ngày' d 'tháng' M, yyyy")}</p>
      <div className="dash">
        <div className="glass panel" style={{ gridColumn: 'span 3', cursor: 'pointer' }} onClick={() => go('work')}>
          <div className="muted small">Lịch hôm nay</div><div className="stat">{todayItems.length}</div>
        </div>
        <div className="glass panel" style={{ gridColumn: 'span 3', cursor: 'pointer' }} onClick={() => go('work')}>
          <div className="muted small">Hạn đăng 7 ngày tới</div><div className="stat" style={{ color: 'var(--wine)' }}>{deadlines.length}</div>
        </div>
        <div className="glass panel" style={{ gridColumn: 'span 3', cursor: 'pointer' }} onClick={() => go('work')}>
          <div className="muted small">Hàng trong kho chờ quay</div><div className="stat">{live.filter((i) => i.status === 'stock').length}</div>
        </div>
        <div className="glass panel" style={{ gridColumn: 'span 3', cursor: 'pointer' }} onClick={() => go('finance')}>
          <div className="muted small">Số dư tháng</div><div className="stat">{money(inc - out)}</div>
        </div>

        <div className="glass panel" style={{ gridColumn: 'span 4' }}>
          <h3><CalendarDays size={18} /> Hôm nay cần làm</h3>
          <div className="list">
            {todayItems.map((i) => (
              <div key={i.id} className="card row">
                <span className={cx('chip', i.status === 'posted' ? 'posted' : i.kind)} style={{ width: 8, height: 28, padding: 0 }} />
                <div className="grow"><div style={{ fontWeight: 600 }}>{i.title}</div><div className="small muted">{i.brand}</div></div>
              </div>
            ))}
            {todayItems.length === 0 && <div className="empty">Không có lịch quay/đăng hôm nay.</div>}
          </div>
        </div>

        <div className="glass panel" style={{ gridColumn: 'span 4' }}>
          <h3><AlertTriangle size={18} /> Sắp tới hạn đăng</h3>
          <div className="list">
            {deadlines.map((i) => {
              const late = i.deadline! < today
              return (
                <div key={i.id} className="card row">
                  <div className="grow"><div style={{ fontWeight: 600 }}>{i.title}</div><div className="small muted">{i.brand}</div></div>
                  <span className={cx('tag', (late || i.deadline === today) && 'red')}>
                    {late ? 'Quá hạn' : i.deadline === today ? 'Hôm nay' : fmt(i.deadline!, 'dd/MM')}
                  </span>
                </div>
              )
            })}
            {deadlines.length === 0 && <div className="empty">Không có deadline gần.</div>}
          </div>
        </div>

        <div className="glass panel" style={{ gridColumn: 'span 4' }}>
          <h3><BellRing size={18} /> Nhắc việc</h3>
          <div className="list">
            {upcoming.map((r) => (
              <div key={r.id} className="card row">
                <button className="hcell" onClick={() => upsertReminder({ id: r.id, done: true })} aria-label="Xong" />
                <div className="grow"><div style={{ fontWeight: 600 }}>{r.title}</div><div className="small muted">{whenLabel(r.at)}</div></div>
              </div>
            ))}
            {upcoming.length === 0 && <div className="empty">Không còn nhắc việc.</div>}
          </div>
        </div>

        <div className="glass panel" style={{ gridColumn: 'span 8' }}>
          <h3><Flame size={18} /> Thói quen hôm nay</h3>
          <div className="list">
            {habits.map((h) => {
              const on = !!h.log[today]
              return (
                <div key={h.id} className="row">
                  <button
                    className={cx('hcell', on && 'on')}
                    style={{ background: on ? h.color : undefined, opacity: on ? undefined : 0.5, cursor: on ? undefined : 'not-allowed' }}
                    disabled={!on}
                    title={on ? undefined : 'Tích sau khi qua ngày hôm nay'}
                    onClick={() => toggleHabit(h.id, today)}
                  >
                    {on && <Check size={14} />}
                  </button>
                  <span className="grow" style={{ fontWeight: 600, textDecoration: on ? 'line-through' : undefined }}>{h.name}</span>
                  <span className="small muted">🔥 {streak(h)} ngày</span>
                </div>
              )
            })}
            {habits.length === 0 && <div className="empty">Chưa có thói quen.</div>}
          </div>
        </div>

        <div className="glass panel" style={{ gridColumn: 'span 4' }}>
          <h3><Headphones size={18} /> Tập trung</h3>
          <p className="small muted" style={{ marginTop: 0 }}>Bật tiếng mưa để vào guồng làm việc.</p>
          <button className={cx('btn', rainOn ? 'dark' : '')} onClick={() => relax.toggle('rain')}>
            {rainOn ? <><Pause size={15} /> Tắt tiếng mưa</> : <><Play size={15} /> Phát tiếng mưa</>}
          </button>
          <button className="btn ghost" onClick={() => go('relax')}>Mở Relax →</button>
        </div>

        <FxPanel />
      </div>
    </>
  )
}
