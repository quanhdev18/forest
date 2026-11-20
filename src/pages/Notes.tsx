import { useState } from 'react'
import { Pin, Plus, Search, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { fmt } from '../lib/utils'

export default function Notes() {
  const { notes, upsertNote, removeNote } = useStore()
  const [q, setQ] = useState('')
  const list = notes
    .filter((n) => n.text.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Ghi chú</h1>
        <div className="row">
          <div className="row btn" style={{ padding: '4px 12px' }}>
            <Search size={15} />
            <input style={{ border: 0, background: 'transparent', outline: 'none', width: 160 }} placeholder="Tìm ghi chú…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn dark" onClick={() => upsertNote({ text: '', pinned: false })}><Plus size={15} /> Ghi chú mới</button>
        </div>
      </div>
      <div className="notes">
        {list.map((n) => (
          <div key={n.id} className="glass note">
            <textarea
              value={n.text}
              placeholder="Viết gì đó…"
              autoFocus={!n.text}
              rows={Math.max(3, n.text.split('\n').length + 1)}
              onChange={(e) => upsertNote({ id: n.id, text: e.target.value })}
            />
            <div className="row small muted">
              <span className="grow">{fmt(n.updatedAt, 'HH:mm dd/MM')}</span>
              <button className="icon-btn" onClick={() => upsertNote({ id: n.id, pinned: !n.pinned })} title="Ghim">
                <Pin size={14} fill={n.pinned ? 'currentColor' : 'none'} />
              </button>
              <button className="icon-btn" onClick={() => removeNote(n.id)} title="Xoá"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      {list.length === 0 && <div className="empty">Không có ghi chú nào.</div>}
    </>
  )
}
