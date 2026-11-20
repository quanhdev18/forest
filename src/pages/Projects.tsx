import { useCallback, useEffect, useRef, useState } from 'react'
import { addMonths, startOfMonth } from 'date-fns'
import { ArrowUp, ChevronLeft, ChevronRight, Target, Trash2 } from 'lucide-react'
import { Project, useStore } from '../store'
import { Modal } from '../components/ui'
import { fmt, money } from '../lib/utils'
import { api } from '../lib/tiktokApi'

const ST: Record<Project['status'], [string, string]> = {
  idea: ['Ý tưởng', 'tag'],
  doing: ['Đang làm', 'tag red'],
  done: ['Xong', 'tag green'],
}

/** số bài Đăng TikTok theo dự án trong tháng: total = đã lên lịch/đã gửi/đã đăng (trừ bài lỗi), posted = đã đăng */
type Counts = Record<string, { total: number; posted: number }>

/** Đếm bài theo dự án của một tháng (giờ địa phương). Lỗi (chưa đăng nhập, chưa chạy SQL…) -> báo qua note. */
function useProjectCounts(month: Date) {
  const [counts, setCounts] = useState<Counts>({})
  const [note, setNote] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const from = startOfMonth(month).toISOString()
      const to = addMonths(startOfMonth(month), 1).toISOString()
      const r = await api<{ counts: Counts; needs_sql: boolean }>('project-counts', {}, `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      setCounts(r.counts)
      setNote(r.needs_sql ? 'Chưa đếm được video: chạy lại file supabase/tiktok.sql trên Supabase để thêm cột dự án.' : null)
    } catch (e) {
      setCounts({})
      setNote('Chưa đếm được video từ mục Đăng TikTok: ' + (e instanceof Error ? e.message : String(e)))
    }
  }, [month])
  useEffect(() => { void load() }, [load])
  return { counts, note }
}

function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const done = max > 0 && value >= max
  return (
    <div style={{ height: 6, borderRadius: 4, background: 'rgba(0,0,0,.08)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: done ? '#1e7a45' : 'var(--wine)', borderRadius: 4, transition: 'width .3s' }} />
    </div>
  )
}

function ProjectModal({ p, onClose }: { p: Project; onClose: () => void }) {
  const { upsertProject, removeProject } = useStore()
  const [f, setF] = useState(p)
  return (
    <Modal title="Dự án" onClose={onClose}>
      <label className="field">Tên<input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="field">Mô tả<textarea className="textarea" rows={3} value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></label>
      <div className="grid2">
        <label className="field">Trạng thái
          <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Project['status'] })}>
            {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
          </select>
        </label>
        <label className="field">KPI video / tháng
          <input
            className="input"
            type="number"
            min={0}
            max={1000}
            placeholder="Không đặt"
            value={f.kpiVideos || ''}
            onChange={(e) => setF({ ...f, kpiVideos: Math.max(0, Math.min(1000, Math.floor(Number(e.target.value) || 0))) })}
          />
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Video được tính khi bạn gán dự án cho bài ở mục Đăng TikTok. Thu chi được tính từ giao dịch gán dự án ở mục Tài chính.
      </p>
      <div className="modal-actions">
        <button className="btn ghost danger" onClick={() => { removeProject(p.id); onClose() }}><Trash2 size={15} /> Xoá</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Huỷ</button>
        <button className="btn dark" onClick={() => { upsertProject(f); onClose() }}>Lưu</button>
      </div>
    </Modal>
  )
}

export default function Projects() {
  const { projects, upsertProject, transactions } = useStore()
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)
  const [edit, setEdit] = useState<Project | null>(null)
  const [title, setTitle] = useState('')
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const { counts, note } = useProjectCounts(month)

  const mk = fmt(month, 'yyyy-MM')
  const money4 = (id: string) => {
    const tx = transactions.filter((t) => t.projectId === id && t.date.startsWith(mk))
    const inc = tx.filter((t) => t.type === 'in').reduce((s, t) => s + t.amount, 0)
    const out = tx.filter((t) => t.type === 'out').reduce((s, t) => s + t.amount, 0)
    return { inc, out }
  }
  const thisMonth = mk === fmt(new Date(), 'yyyy-MM')

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const x = Math.min(92, Math.max(8, ((e.clientX - r.left) / r.width) * 100))
    const y = Math.min(90, Math.max(8, ((e.clientY - r.top) / r.height) * 100))
    drag.current.moved = true
    upsertProject({ id: drag.current.id, x, y })
  }

  const add = () => {
    if (!title.trim()) return
    const a = Math.random() * Math.PI * 2
    upsertProject({ title: title.trim(), desc: '', status: 'idea', x: 50 + Math.cos(a) * 28, y: 45 + Math.sin(a) * 28 })
    setTitle('')
  }

  return (
    <>
      <h1 className="page-title">Dự án</h1>
      <div
        className="canvas glass"
        ref={ref}
        onPointerMove={onMove}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (d && !d.moved) setEdit(projects.find((p) => p.id === d.id) ?? null)
        }}
        onPointerLeave={() => (drag.current = null)}
      >
        <svg className="links">
          {projects.map((p) => (
            <line key={p.id} x1="50%" y1="50%" x2={`${p.x}%`} y2={`${p.y}%`} stroke="rgba(20,20,20,.18)" strokeDasharray="4 6" />
          ))}
        </svg>
        <div className="core" title="Bạn" />
        {projects.map((p) => {
          const n = counts[p.id]?.total ?? 0
          return (
            <div
              key={p.id}
              className="pnode"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { id: p.id, moved: false } }}
            >
              <h4>{p.title}</h4>
              {p.desc && <p>{p.desc}</p>}
              <span className={ST[p.status][1]}>{ST[p.status][0]}</span>
              {!!p.kpiVideos && (
                <div style={{ marginTop: 6 }}>
                  <div className="small" style={{ fontWeight: 700, marginBottom: 3 }}>{n}/{p.kpiVideos} video</div>
                  <Progress value={n} max={p.kpiVideos} />
                </div>
              )}
            </div>
          )
        })}
        <div className="pbar">
          <input placeholder="Thêm dự án / kênh mới…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="icon-btn" style={{ background: 'var(--black)', color: '#fff' }} onClick={add} aria-label="Thêm"><ArrowUp size={16} /></button>
        </div>
      </div>

      {/* ---------- KPI & thu chi theo tháng ---------- */}
      <div className="glass panel" style={{ marginTop: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
          <h3 className="grow" style={{ margin: 0 }}><Target size={18} /> KPI {thisMonth ? 'tháng này' : fmt(month, "'tháng' M/yyyy")}</h3>
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Tháng trước"><ChevronLeft size={18} /></button>
          <span className="btn">{fmt(month, "'Tháng' M/yyyy")}</span>
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Tháng sau"><ChevronRight size={18} /></button>
        </div>
        {note && <div className="small" style={{ color: 'var(--wine)', marginBottom: 8 }}>{note}</div>}
        {projects.length === 0 ? (
          <div className="empty">Chưa có dự án. Thêm dự án ở ô phía trên rồi bấm vào dự án để đặt KPI.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tx">
              <thead>
                <tr>
                  <th>Dự án</th>
                  <th style={{ minWidth: 160 }}>Video / KPI</th>
                  <th style={{ textAlign: 'right' }}>Thu</th>
                  <th style={{ textAlign: 'right' }}>Chi</th>
                  <th style={{ textAlign: 'right' }}>Lãi</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const c = counts[p.id] ?? { total: 0, posted: 0 }
                  const { inc, out } = money4(p.id)
                  return (
                    <tr key={p.id} onClick={() => setEdit(p)} style={{ cursor: 'pointer' }} title="Bấm để sửa dự án / KPI">
                      <td><b>{p.title}</b> <span className={ST[p.status][1]}>{ST[p.status][0]}</span></td>
                      <td>
                        {p.kpiVideos ? (
                          <>
                            <div className="small" style={{ marginBottom: 3 }}>
                              <b>{c.total}/{p.kpiVideos}</b> video
                              {c.total >= p.kpiVideos ? ' · đạt KPI 🎉' : ` · còn ${p.kpiVideos - c.total}`}
                              {c.total > c.posted && <span className="muted"> ({c.posted} đã đăng)</span>}
                            </div>
                            <Progress value={c.total} max={p.kpiVideos} />
                          </>
                        ) : (
                          <span className="small muted">{c.total} video · chưa đặt KPI</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', color: '#1e6b3a' }}>{inc ? money(inc) : '—'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--wine)' }}>{out ? money(out) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{inc || out ? money(inc - out) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Video = bài ở mục Đăng TikTok gán dự án, tính theo giờ đăng trong tháng (không tính bài lỗi). Thu chi lấy từ giao dịch gán dự án ở mục Tài chính.
        </p>
      </div>

      {edit && <ProjectModal p={edit} onClose={() => setEdit(null)} />}
    </>
  )
}
