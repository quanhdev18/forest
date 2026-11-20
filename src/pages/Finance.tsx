import { useState } from 'react'
import { addMonths, startOfMonth } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Transaction, useStore } from '../store'
import { Modal } from '../components/ui'
import { dkey, fmt, money } from '../lib/utils'

const CATS = { in: ['Booking', 'Affiliate', 'Lương', 'Khác'], out: ['Ăn uống', 'Đạo cụ', 'Di chuyển', 'Nhà cửa', 'Giải trí', 'Khác'] }

// Bộ lọc: '' = tất cả, NONE = nhập riêng (không thuộc dự án), còn lại = id dự án
const NONE = '__none__'

function TxModal({ onClose, defaultProject }: { onClose: () => void; defaultProject?: string }) {
  const upsertTx = useStore((s) => s.upsertTx)
  const projects = useStore((s) => s.projects)
  const [f, setF] = useState<Omit<Transaction, 'id'>>({
    type: 'out', amount: 0, category: 'Ăn uống', date: dkey(new Date()), note: '', projectId: defaultProject || undefined,
  })
  const set = (p: Partial<Transaction>) => setF((x) => ({ ...x, ...p }))
  const save = () => { if (f.amount > 0) { upsertTx(f); onClose() } }
  return (
    <Modal title="Thêm giao dịch" onClose={onClose}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={f.type === 'out' ? 'on' : ''} onClick={() => set({ type: 'out', category: CATS.out[0] })}>Chi</button>
        <button className={f.type === 'in' ? 'on' : ''} onClick={() => set({ type: 'in', category: CATS.in[0] })}>Thu</button>
      </div>
      <div className="grid2">
        <label className="field">Số tiền (₫)<input className="input" type="number" autoFocus min={0} value={f.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) })} /></label>
        <label className="field">Ngày<input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>
      </div>
      <label className="field">Danh mục
        <select className="select" value={f.category} onChange={(e) => set({ category: e.target.value })}>
          {CATS[f.type].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="field">Dự án
        <select className="select" value={f.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || undefined })}>
          <option value="">— Nhập riêng (không thuộc dự án) —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </label>
      <label className="field">Ghi chú<input className="input" value={f.note} onChange={(e) => set({ note: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} /></label>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Huỷ</button>
        <button className="btn dark" onClick={save}>Lưu</button>
      </div>
    </Modal>
  )
}

export default function Finance() {
  const { transactions, removeTx, projects, upsertTx } = useStore()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [open, setOpen] = useState(false)
  const [proj, setProj] = useState('') // bộ lọc dự án
  const mk = fmt(month, 'yyyy-MM')
  const projectName = (id?: string) => (id ? projects.find((p) => p.id === id)?.title ?? 'Dự án đã xoá' : null)
  const list = transactions
    .filter((t) => t.date.startsWith(mk))
    .filter((t) => (proj === '' ? true : proj === NONE ? !t.projectId : t.projectId === proj))
    .sort((a, b) => b.date.localeCompare(a.date))
  const inc = list.filter((t) => t.type === 'in').reduce((s, t) => s + t.amount, 0)
  const out = list.filter((t) => t.type === 'out').reduce((s, t) => s + t.amount, 0)
  const byCat = Object.entries(
    list.filter((t) => t.type === 'out').reduce<Record<string, number>>((m, t) => ((m[t.category] = (m[t.category] ?? 0) + t.amount), m), {}),
  ).sort((a, b) => b[1] - a[1])

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Tài chính</h1>
        <div className="row">
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={18} /></button>
          <span className="btn">{fmt(month, "'Tháng' M/yyyy")}</span>
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={18} /></button>
          <select className="select" value={proj} onChange={(e) => setProj(e.target.value)} aria-label="Lọc theo dự án" style={{ width: 'auto', maxWidth: 220 }}>
            <option value="">Tất cả dự án</option>
            <option value={NONE}>Nhập riêng (không dự án)</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <button className="btn dark" onClick={() => setOpen(true)}><Plus size={15} /> Giao dịch</button>
        </div>
      </div>
      <div className="dash">
        <div className="glass panel" style={{ gridColumn: 'span 4' }}><div className="muted small">Thu</div><div className="stat" style={{ color: '#1e6b3a' }}>{money(inc)}</div></div>
        <div className="glass panel" style={{ gridColumn: 'span 4' }}><div className="muted small">Chi</div><div className="stat" style={{ color: 'var(--wine)' }}>{money(out)}</div></div>
        <div className="glass panel" style={{ gridColumn: 'span 4' }}><div className="muted small">Còn lại</div><div className="stat">{money(inc - out)}</div></div>
        <div className="glass panel" style={{ gridColumn: 'span 8' }}>
          <h3>Giao dịch</h3>
          <table className="tx">
            <thead><tr><th>Ngày</th><th>Danh mục</th><th>Ghi chú</th><th>Dự án</th><th style={{ textAlign: 'right' }}>Số tiền</th><th /></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>{fmt(t.date, 'dd/MM')}</td>
                  <td><span className={t.type === 'in' ? 'tag green' : 'tag red'}>{t.category}</span></td>
                  <td>{t.note}</td>
                  <td>
                    {/* đổi dự án ngay trong bảng */}
                    <select
                      className="select"
                      value={t.projectId ?? ''}
                      onChange={(e) => upsertTx({ id: t.id, projectId: e.target.value || undefined })}
                      aria-label="Dự án của giao dịch"
                      style={{ padding: '4px 8px', fontSize: 12, maxWidth: 150 }}
                      title={projectName(t.projectId) ?? 'Nhập riêng'}
                    >
                      <option value="">Riêng</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: t.type === 'in' ? '#1e6b3a' : undefined }}>
                    {t.type === 'in' ? '+' : '−'}{money(t.amount)}
                  </td>
                  <td><button className="icon-btn" onClick={() => removeTx(t.id)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <div className="empty">Chưa có giao dịch trong tháng.</div>}
        </div>
        <div className="glass panel" style={{ gridColumn: 'span 4' }}>
          <h3>Chi theo danh mục</h3>
          <div className="list">
            {byCat.map(([c, v]) => (
              <div key={c}>
                <div className="row small"><span className="grow">{c}</span><b>{money(v)}</b></div>
                <div style={{ height: 6, borderRadius: 4, background: 'rgba(0,0,0,.06)', marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${(v / out) * 100}%`, background: 'var(--wine)', borderRadius: 4 }} />
                </div>
              </div>
            ))}
            {byCat.length === 0 && <div className="empty">Chưa có khoản chi.</div>}
          </div>
        </div>
      </div>
      {open && <TxModal onClose={() => setOpen(false)} defaultProject={proj && proj !== NONE ? proj : undefined} />}
    </>
  )
}
