import { useState } from 'react'
import { Trash2, Archive } from 'lucide-react'
import { ContentItem, STATUS_LABEL, Status, useStore } from '../store'
import { Modal, useToasts } from './ui'
import { dkey } from '../lib/utils'

export function ItemModal({ item, onClose }: { item: Partial<ContentItem>; onClose: () => void }) {
  const { upsertItem, removeItem, upsertTx } = useStore()
  const [f, setF] = useState<Partial<ContentItem>>({ kind: 'product', status: 'waiting', title: '', brand: '', ...item })
  const set = (p: Partial<ContentItem>) => setF((x) => ({ ...x, ...p }))
  const isNew = !item.id

  const save = () => {
    if (!f.title?.trim()) return
    let paid = f.paid
    if (f.kind === 'booking' && f.status === 'posted' && f.fee && !paid) {
      upsertTx({ type: 'in', amount: f.fee, category: 'Booking', date: dkey(new Date()), note: `${f.brand} – ${f.title}` })
      paid = true
      useToasts.getState().push(`Đã ghi thu ${f.fee.toLocaleString('vi-VN')} ₫ vào Tài chính`)
    }
    upsertItem({ ...f, paid, title: f.title.trim(), brand: f.brand?.trim() ?? '' })
    onClose()
  }

  return (
    <Modal title={isNew ? 'Thêm mục mới' : 'Sửa mục'} onClose={onClose}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {(['product', 'booking'] as const).map((k) => (
          <button key={k} className={f.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>
            {k === 'product' ? 'Sản phẩm' : 'Booking'}
          </button>
        ))}
      </div>
      <label className="field">
        Tên sản phẩm
        <input className="input" autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="VD: Máy sấy tóc" />
      </label>
      <div className="grid2">
        <label className="field">
          Thương hiệu
          <input className="input" value={f.brand} onChange={(e) => set({ brand: e.target.value })} />
        </label>
        <label className="field">
          Trạng thái
          <select className="select" value={f.status} onChange={(e) => set({ status: e.target.value as Status })}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          Ngày lên lịch
          <input className="input" type="date" value={f.date ?? ''} onChange={(e) => set({ date: e.target.value || undefined })} />
        </label>
        {f.kind === 'booking' && (
          <label className="field">
            Hạn đăng
            <input className="input" type="date" value={f.deadline ?? ''} onChange={(e) => set({ deadline: e.target.value || undefined })} />
          </label>
        )}
        {f.kind === 'booking' && (
          <label className="field">
            Phí booking (₫)
            <input className="input" type="number" min={0} value={f.fee ?? ''} onChange={(e) => set({ fee: e.target.value ? Number(e.target.value) : undefined })} />
          </label>
        )}
        <label className="field">
          Nền tảng
          <input className="input" value={f.platform ?? ''} onChange={(e) => set({ platform: e.target.value })} placeholder="TikTok, Reels…" />
        </label>
      </div>
      <label className="field">
        Ghi chú
        <textarea className="textarea" rows={3} value={f.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
      </label>
      <div className="modal-actions">
        {!isNew && (
          <>
            <button className="btn ghost danger" onClick={() => { removeItem(item.id!); onClose() }}><Trash2 size={15} /> Xoá</button>
            <button className="btn ghost" onClick={() => { upsertItem({ id: item.id, archived: !item.archived }); onClose() }}>
              <Archive size={15} /> {item.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'}
            </button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Huỷ</button>
        <button className="btn dark" onClick={save}>Lưu</button>
      </div>
    </Modal>
  )
}
