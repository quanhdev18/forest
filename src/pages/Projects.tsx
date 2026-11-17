import { useRef, useState } from 'react'
import { ArrowUp, Trash2 } from 'lucide-react'
import { Project, useStore } from '../store'
import { Modal } from '../components/ui'

const ST: Record<Project['status'], [string, string]> = {
  idea: ['Ý tưởng', 'tag'],
  doing: ['Đang làm', 'tag red'],
  done: ['Xong', 'tag green'],
}

function ProjectModal({ p, onClose }: { p: Project; onClose: () => void }) {
  const { upsertProject, removeProject } = useStore()
  const [f, setF] = useState(p)
  return (
    <Modal title="Dự án" onClose={onClose}>
      <label className="field">Tên<input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="field">Mô tả<textarea className="textarea" rows={3} value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></label>
      <label className="field">Trạng thái
        <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Project['status'] })}>
          {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
        </select>
      </label>
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
  const { projects, upsertProject } = useStore()
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)
  const [edit, setEdit] = useState<Project | null>(null)
  const [title, setTitle] = useState('')

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
      <h1 className="page-title">Project</h1>
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
        {projects.map((p) => (
          <div
            key={p.id}
            className="pnode"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { id: p.id, moved: false } }}
          >
            <h4>{p.title}</h4>
            {p.desc && <p>{p.desc}</p>}
            <span className={ST[p.status][1]}>{ST[p.status][0]}</span>
          </div>
        ))}
        <div className="pbar">
          <input placeholder="Thêm dự án / kênh mới…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="icon-btn" style={{ background: 'var(--black)', color: '#fff' }} onClick={add} aria-label="Thêm"><ArrowUp size={16} /></button>
        </div>
      </div>
      {edit && <ProjectModal p={edit} onClose={() => setEdit(null)} />}
    </>
  )
}
