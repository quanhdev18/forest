import { ReactNode, useEffect } from 'react'
import { create } from 'zustand'
import { Bell, X } from 'lucide-react'
import { uid } from '../lib/utils'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export type ToastKind = 'info' | 'reminder'
interface Toast { id: string; text: string; kind: ToastKind }

/** Thông báo ở lại màn hình cho đến khi người dùng bấm vào đâu đó để ẩn */
export const useToasts = create<{ list: Toast[]; push: (t: string, kind?: ToastKind) => void; clear: () => void; dismiss: (id: string) => void }>((set) => ({
  list: [],
  push: (text, kind = 'info') =>
    set((s) => ({ list: [...s.list, { id: uid(), text, kind }].slice(-6) })),
  clear: () => set({ list: [] }),
  dismiss: (id) => set((s) => ({ list: s.list.filter((x) => x.id !== id) })),
}))

export function Toasts() {
  const { list, clear, dismiss } = useToasts()

  // bấm bất kỳ đâu trên màn hình thì ẩn tất cả thông báo
  useEffect(() => {
    if (list.length === 0) return
    const onDown = (e: PointerEvent) => {
      // bấm vào một thông báo thì chỉ ẩn thông báo đó
      const el = (e.target as HTMLElement).closest?.('[data-toast-id]') as HTMLElement | null
      if (el) dismiss(el.dataset.toastId!)
      else clear()
    }
    // đăng ký ở bước tiếp theo để cú bấm tạo thông báo không tự ẩn nó
    const t = setTimeout(() => window.addEventListener('pointerdown', onDown), 0)
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', onDown) }
  }, [list.length, clear, dismiss])

  if (list.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} data-toast-id={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon"><Bell size={t.kind === 'reminder' ? 20 : 16} /></span>
          <span className="toast-text">{t.text}</span>
          <span className="toast-x" aria-hidden><X size={14} /></span>
        </div>
      ))}
      <div className="toast-hint">Bấm để ẩn</div>
    </div>
  )
}
