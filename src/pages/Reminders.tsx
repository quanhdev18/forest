import { useState } from 'react'
import { format, isToday, isTomorrow } from 'date-fns'
import { BellRing, Check, Plus, Repeat as RepeatIcon, Trash2 } from 'lucide-react'
import { Reminder, Repeat, useStore } from '../store'
import { Modal } from '../components/ui'
import { cx, fmt } from '../lib/utils'

const REPEAT: Record<Repeat, string> = { none: 'Một lần', daily: 'Hằng ngày', weekly: 'Hằng tuần' }

export const whenLabel = (iso: string) => {
  const d = new Date(iso)
  const day = isToday(d) ? 'Hôm nay' : isTomorrow(d) ? 'Ngày mai' : fmt(d, 'EEE dd/MM')
  return `${day} · ${format(d, 'HH:mm')}`
}

function ReminderModal({ r, onClose }: { r: Partial<Reminder>; onClose: () => void }) {
  const upsert = useStore((s) => s.upsertReminder)
  const init = r.at ? new Date(r.at) : new Date(Date.now() + 3600e3)
  const [title, setTitle] = useState(r.title ?? '')
  const [at, setAt] = useState(format(init, "yyyy-MM-dd'T'HH:mm"))
  const [repeat, setRepeat] = useState<Repeat>(r.repeat ?? 'none')
  const save = () => {
    if (!title.trim()) return
    upsert({ id: r.id, title: title.trim(), at: new Date(at).toISOString(), repeat, firedAt: undefined, done: false })
    onClose()
  }
  return (
    <Modal title={r.id ? 'Sửa nhắc việc' : 'Nhắc việc mới'} onClose={onClose}>
      <label className="field">Nội dung<input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} /></label>
      <div className="grid2">
        <label className="field">Thời gian<input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
        <label className="field">Lặp lại
          <select className="select" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {Object.entries(REPEAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Huỷ</button>
        <button className="btn dark" onClick={save}>Lưu</button>
      </div>
    </Modal>
  )
}

export default function Reminders() {
  const { reminders, upsertReminder, removeReminder } = useStore()
  const [edit, setEdit] = useState<Partial<Reminder> | null>(null)
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied')
  const sorted = [...reminders].sort((a, b) => Number(a.done) - Number(b.done) || a.at.localeCompare(b.at))
  const now = Date.now()

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Reminder</h1>
        <div className="row">
          {perm !== 'granted' && typeof Notification !== 'undefined' && (
            <button className="btn" onClick={() => Notification.requestPermission().then(setPerm)}>
              <BellRing size={15} /> Bật thông báo
            </button>
          )}
          <button className="btn dark" onClick={() => setEdit({})}><Plus size={15} /> Thêm nhắc việc</button>
        </div>
      </div>
      <div className="glass panel" style={{ maxWidth: 760 }}>
        <div className="list">
          {sorted.map((r) => {
            const overdue = !r.done && new Date(r.at).getTime() < now && r.repeat === 'none'
            return (
              <div key={r.id} className="card row" style={{ opacity: r.done ? 0.5 : 1 }}>
                <button
                  className={cx('hcell', r.done && 'on')}
                  style={{ background: r.done ? 'var(--black)' : undefined }}
                  onClick={() => upsertReminder({ id: r.id, done: !r.done })}
                  aria-label="Hoàn thành"
                >
                  {r.done && <Check size={16} />}
                </button>
                <div className="grow" onClick={() => setEdit(r)} style={{ cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600, textDecoration: r.done ? 'line-through' : undefined }}>{r.title}</div>
                  <div className="small muted">{whenLabel(r.at)}</div>
                </div>
                {r.repeat !== 'none' && <span className="tag"><RepeatIcon size={11} /> {REPEAT[r.repeat]}</span>}
                {overdue && <span className="tag red">Quá giờ</span>}
                <button className="icon-btn" onClick={() => removeReminder(r.id)} aria-label="Xoá"><Trash2 size={15} /></button>
              </div>
            )
          })}
          {sorted.length === 0 && <div className="empty">Chưa có nhắc việc nào.</div>}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Nhắc việc sẽ hiện thông báo + âm báo khi tab Forest đang mở.
        </p>
      </div>
      {edit && <ReminderModal r={edit} onClose={() => setEdit(null)} />}
    </>
  )
}
