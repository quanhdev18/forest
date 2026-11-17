import { useState } from 'react'
import { ContentItem, STATUS_LABEL, useStore } from '../store'
import { ItemModal } from '../components/ItemModal'

export default function ArchivePage() {
  const items = useStore((s) => s.items).filter((i) => i.archived)
  const [edit, setEdit] = useState<ContentItem | null>(null)
  return (
    <>
      <h1 className="page-title">Lưu trữ</h1>
      <div className="glass panel" style={{ maxWidth: 720 }}>
        <div className="list">
          {items.map((i) => (
            <div key={i.id} className="card row" style={{ cursor: 'pointer' }} onClick={() => setEdit(i)}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{i.title}</div>
                <div className="small muted">{i.brand} · {i.kind === 'booking' ? 'Booking' : 'Sản phẩm'}</div>
              </div>
              <span className="tag">{STATUS_LABEL[i.status]}</span>
            </div>
          ))}
          {items.length === 0 && <div className="empty">Chưa có mục nào được lưu trữ. Mở một mục ở trang Công việc và chọn "Lưu trữ" để dọn lịch.</div>}
        </div>
      </div>
      {edit && <ItemModal item={edit} onClose={() => setEdit(null)} />}
    </>
  )
}
