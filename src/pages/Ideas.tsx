import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Idea, IDEA_STAGES, IdeaStage, useStore } from '../store'
import { Modal } from '../components/ui'
import { cx, fmt } from '../lib/utils'

/** id thẻ đang được kéo (dùng chung cho mọi cột) */
let dragId: string | null = null

export default function Ideas() {
  const ideas = useStore((s) => s.ideas ?? [])
  const upsertIdea = useStore((s) => s.upsertIdea)
  const [edit, setEdit] = useState<Partial<Idea> | null>(null)
  const [over, setOver] = useState<IdeaStage | null>(null)

  const moveTo = (id: string, stage: IdeaStage) => upsertIdea({ id, stage })
  const shift = (idea: Idea, dir: -1 | 1) => {
    const i = IDEA_STAGES.findIndex((s) => s.id === idea.stage) + dir
    if (i >= 0 && i < IDEA_STAGES.length) moveTo(idea.id, IDEA_STAGES[i].id)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>Ý tưởng</h1>
          <p className="small muted" style={{ margin: 0 }}>Kéo thẻ giữa các cột, hoặc dùng nút ← → trên điện thoại.</p>
        </div>
        <button className="btn dark" onClick={() => setEdit({ stage: 'idea' })}><Plus size={15} /> Ý tưởng mới</button>
      </div>

      <div className="kanban">
        {IDEA_STAGES.map((st, colIdx) => {
          const list = ideas.filter((i) => i.stage === st.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          return (
            <section
              key={st.id}
              className={cx('kcol', over === st.id && 'drop')}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (over !== st.id) setOver(st.id)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId) moveTo(dragId, st.id)
                dragId = null
                setOver(null)
              }}
            >
              <header className="kcol-h">
                <span>{st.label}</span>
                <span className="count">{list.length}</span>
                {colIdx === 0 && (
                  <button className="icon-btn" onClick={() => setEdit({ stage: 'idea' })} aria-label="Thêm ý tưởng"><Plus size={16} /></button>
                )}
              </header>

              <div className="kcol-body">
                {list.map((idea) => (
                  <article
                    key={idea.id}
                    className="kcard"
                    draggable
                    onDragStart={(e) => {
                      dragId = idea.id
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', idea.id)
                    }}
                    onDragEnd={() => { dragId = null; setOver(null) }}
                    onClick={() => setEdit(idea)}
                  >
                    <div className="kcard-title">{idea.title}</div>
                    {idea.script && <div className="kcard-script">{idea.script}</div>}
                    <div className="kcard-foot">
                      <span className="small muted">{fmt(idea.updatedAt, 'dd/MM')}</span>
                      <span className="grow" />
                      <button
                        className="icon-btn"
                        disabled={colIdx === 0}
                        onClick={(e) => { e.stopPropagation(); shift(idea, -1) }}
                        aria-label="Chuyển cột trước"
                      ><ChevronLeft size={16} /></button>
                      <button
                        className="icon-btn"
                        disabled={colIdx === IDEA_STAGES.length - 1}
                        onClick={(e) => { e.stopPropagation(); shift(idea, 1) }}
                        aria-label="Chuyển cột sau"
                      ><ChevronRight size={16} /></button>
                    </div>
                  </article>
                ))}
                {list.length === 0 && <div className="empty" style={{ textAlign: 'center' }}>Trống</div>}
              </div>
            </section>
          )
        })}
      </div>

      {edit && <IdeaModal idea={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function IdeaModal({ idea, onClose }: { idea: Partial<Idea>; onClose: () => void }) {
  const { upsertIdea, removeIdea } = useStore()
  const [f, setF] = useState<Partial<Idea>>({ title: '', script: '', stage: 'idea', ...idea })
  const isNew = !idea.id

  const save = () => {
    if (!f.title?.trim()) return
    upsertIdea({ ...f, title: f.title.trim(), script: f.script ?? '' })
    onClose()
  }

  return (
    <Modal title={isNew ? 'Ý tưởng mới' : 'Sửa ý tưởng'} onClose={onClose}>
      <label className="field">
        Tên ý tưởng
        <input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="VD: Review máy lọc không khí" />
      </label>
      <label className="field">
        Kịch bản / ghi chú
        <textarea className="textarea" rows={7} value={f.script} onChange={(e) => setF({ ...f, script: e.target.value })} placeholder="Hook, các cảnh quay, ý chính…" />
      </label>
      <label className="field">
        Giai đoạn
        <select className="select" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as IdeaStage })}>
          {IDEA_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <div className="modal-actions">
        {!isNew && (
          <button className="btn ghost danger" onClick={() => { if (confirm('Xoá ý tưởng này?')) { removeIdea(idea.id!); onClose() } }}>
            <Trash2 size={15} /> Xoá
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Huỷ</button>
        <button className="btn dark" onClick={save}>Lưu</button>
      </div>
    </Modal>
  )
}
