import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addDays } from 'date-fns'
import { dkey, uid } from './lib/utils'

export type Kind = 'product' | 'booking'
export type Status = 'waiting' | 'stock' | 'posted'

export interface ContentItem {
  id: string
  kind: Kind
  title: string
  brand: string
  status: Status
  /** ngày lên lịch quay/đăng (yyyy-MM-dd) */
  date?: string
  /** hạn đăng – chủ yếu cho booking (yyyy-MM-dd) */
  deadline?: string
  fee?: number
  platform?: string
  note?: string
  archived?: boolean
  /** đã ghi khoản thu vào Finance */
  paid?: boolean
}

export type Repeat = 'none' | 'daily' | 'weekly'
export interface Reminder {
  id: string
  title: string
  at: string // ISO datetime
  repeat: Repeat
  done: boolean
  firedAt?: string
}

export interface Habit {
  id: string
  name: string
  color: string
  log: Record<string, boolean>
  createdAt: string
}

export interface Transaction {
  id: string
  type: 'in' | 'out'
  amount: number
  category: string
  date: string
  note: string
}

export interface Note {
  id: string
  text: string
  pinned: boolean
  updatedAt: string
}

export interface Project {
  id: string
  title: string
  desc: string
  status: 'idea' | 'doing' | 'done'
  x: number // % of canvas
  y: number
}

export type IdeaStage = 'idea' | 'script' | 'shooting' | 'done'
export const IDEA_STAGES: { id: IdeaStage; label: string }[] = [
  { id: 'idea', label: 'Ý tưởng' },
  { id: 'script', label: 'Lên kịch bản' },
  { id: 'shooting', label: 'Đang quay' },
  { id: 'done', label: 'Xong' },
]
export interface Idea {
  id: string
  title: string
  script: string
  stage: IdeaStage
  updatedAt: string
}

export interface Settings {
  blur: number
  glass: number // 0..1 opacity of panels
  accent: string
  scene: 'forest' | 'dusk' | 'lake'
  /** ảnh nền do người dùng tải lên (data URL đã nén); rỗng = dùng khung cảnh có sẵn */
  customBg?: string
}

interface State {
  items: ContentItem[]
  reminders: Reminder[]
  habits: Habit[]
  transactions: Transaction[]
  notes: Note[]
  projects: Project[]
  settings: Settings
  ideas: Idea[]

  upsertIdea: (i: Partial<Idea> & { id?: string }) => void
  removeIdea: (id: string) => void

  upsertItem: (i: Partial<ContentItem> & { id?: string }) => void
  removeItem: (id: string) => void

  upsertReminder: (r: Partial<Reminder> & { id?: string }) => void
  removeReminder: (id: string) => void

  upsertHabit: (h: Partial<Habit> & { id?: string }) => void
  toggleHabit: (id: string, day: string) => void
  removeHabit: (id: string) => void

  upsertTx: (t: Partial<Transaction> & { id?: string }) => void
  removeTx: (id: string) => void

  upsertNote: (n: Partial<Note> & { id?: string }) => string
  removeNote: (id: string) => void

  upsertProject: (p: Partial<Project> & { id?: string }) => void
  removeProject: (id: string) => void

  setSettings: (s: Partial<Settings>) => void
  importAll: (data: Partial<State>) => void
}

function upsert<T extends { id: string }>(list: T[], patch: Partial<T> & { id?: string }, make: () => T): T[] {
  if (patch.id && list.some((x) => x.id === patch.id)) {
    return list.map((x) => (x.id === patch.id ? { ...x, ...patch } : x))
  }
  return [...list, { ...make(), ...patch, id: patch.id ?? uid() }]
}

const today = new Date()
const d = (n: number) => dkey(addDays(today, n))

const seed = {
  items: [
    { id: uid(), kind: 'product', title: 'Kem dưỡng ban đêm', brand: "Kiehl's", status: 'waiting', date: d(2) },
    { id: uid(), kind: 'product', title: 'Máy hút bụi cầm tay', brand: 'Dyson', status: 'waiting', date: d(4) },
    { id: uid(), kind: 'product', title: 'Máy sấy tóc', brand: 'Laifen', status: 'stock', date: d(0) },
    { id: uid(), kind: 'product', title: 'Bộ chăn ga cotton', brand: 'Muji', status: 'stock', date: d(1) },
    { id: uid(), kind: 'product', title: 'Máy lọc không khí', brand: 'Sharp', status: 'stock', date: d(3) },
    { id: uid(), kind: 'product', title: 'Máy pha cà phê cầm tay', brand: 'Cliton', status: 'posted', date: d(-3) },
    { id: uid(), kind: 'booking', title: 'Tai nghe không dây', brand: 'Sony', status: 'stock', date: d(1), deadline: d(5), fee: 3500000, platform: 'TikTok' },
    { id: uid(), kind: 'booking', title: 'Sữa rửa mặt dịu nhẹ', brand: 'Cetaphil', status: 'waiting', date: d(3), deadline: d(8), fee: 2000000, platform: 'Reels' },
    { id: uid(), kind: 'booking', title: 'Nến thơm phòng ngủ', brand: 'Yankee', status: 'stock', date: d(-1), deadline: d(-1), fee: 1500000, platform: 'TikTok' },
    { id: uid(), kind: 'booking', title: 'Loa Bluetooth mini', brand: 'Marshall', status: 'posted', date: d(-6), deadline: d(-5), fee: 4000000, platform: 'YouTube', paid: true },
  ] as ContentItem[],
  reminders: [
    { id: uid(), title: 'Gửi bản nháp video cho brand Sony', at: new Date(today.getTime() + 2 * 3600e3).toISOString(), repeat: 'none', done: false },
    { id: uid(), title: 'Uống nước', at: new Date(today.getTime() + 30 * 60e3).toISOString(), repeat: 'daily', done: false },
  ] as Reminder[],
  habits: [
    { id: uid(), name: 'Đọc sách 20 phút', color: '#6b1a24', log: { [d(-1)]: true, [d(-2)]: true, [d(-3)]: true }, createdAt: d(-10) },
    { id: uid(), name: 'Tập thể dục', color: '#1d1d1f', log: { [d(-1)]: true, [d(-3)]: true }, createdAt: d(-10) },
    { id: uid(), name: 'Đăng 1 video', color: '#5d7f93', log: { [d(-2)]: true }, createdAt: d(-10) },
  ] as Habit[],
  transactions: [
    { id: uid(), type: 'in', amount: 4000000, category: 'Booking', date: d(-5), note: 'Marshall – Loa Bluetooth mini' },
    { id: uid(), type: 'in', amount: 850000, category: 'Affiliate', date: d(-2), note: 'Hoa hồng TikTok Shop' },
    { id: uid(), type: 'out', amount: 320000, category: 'Đạo cụ', date: d(-1), note: 'Phông nền + đèn' },
  ] as Transaction[],
  notes: [
    { id: uid(), text: 'Ý tưởng: series "1 tuần dùng thử" cho đồ gia dụng', pinned: true, updatedAt: new Date().toISOString() },
  ] as Note[],
  projects: [
    { id: uid(), title: 'Web / App Forest', desc: 'Xây web quản lý nội dung & cuộc sống', status: 'doing', x: 28, y: 22 },
    { id: uid(), title: 'Vlog decor phòng và khu vực giường ngủ', desc: 'Nhận hàng decor từ brand, quay vlog', status: 'idea', x: 70, y: 14 },
    { id: uid(), title: 'Tiktok affiliate', desc: 'Phủ 3 video/tuần ngách nhà cửa', status: 'doing', x: 32, y: 72 },
    { id: uid(), title: 'Threads - nhomusaigon', desc: 'Đăng ảnh đời sống Sài Gòn mỗi ngày', status: 'idea', x: 75, y: 62 },
  ] as Project[],
  ideas: [
    { id: uid(), title: 'Review máy sấy tóc 3 ngày', script: 'Hook: "Mình dùng máy sấy này 3 ngày rồi…"\nQuay cận cảnh nút gió, so sánh với máy cũ.', stage: 'script', updatedAt: new Date().toISOString() },
    { id: uid(), title: 'Góc decor phòng ngủ tối giản', script: '', stage: 'idea', updatedAt: new Date().toISOString() },
    { id: uid(), title: 'Thử 5 loại cà phê dưới 100k', script: 'Quay buổi sáng, cắt nhịp nhanh.', stage: 'shooting', updatedAt: new Date().toISOString() },
  ] as Idea[],
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      ...seed,
      settings: { blur: 18, glass: 0.55, accent: '#6b1a24', scene: 'forest' },

      upsertItem: (i) =>
        set((s) => ({ items: upsert(s.items, i, () => ({ id: '', kind: 'product', title: '', brand: '', status: 'waiting' })) })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),

      upsertReminder: (r) =>
        set((s) => ({
          reminders: upsert(s.reminders, r, () => ({ id: '', title: '', at: new Date().toISOString(), repeat: 'none', done: false })),
        })),
      removeReminder: (id) => set((s) => ({ reminders: s.reminders.filter((x) => x.id !== id) })),

      upsertHabit: (h) =>
        set((s) => ({ habits: upsert(s.habits, h, () => ({ id: '', name: '', color: '#6b1a24', log: {}, createdAt: dkey(new Date()) })) })),
      toggleHabit: (id, day) =>
        set((s) => ({
          habits: s.habits.map((h) => {
            if (h.id !== id) return h
            const log = { ...h.log }
            if (log[day]) delete log[day]
            else log[day] = true
            return { ...h, log }
          }),
        })),
      removeHabit: (id) => set((s) => ({ habits: s.habits.filter((x) => x.id !== id) })),

      upsertTx: (t) =>
        set((s) => ({
          transactions: upsert(s.transactions, t, () => ({ id: '', type: 'out', amount: 0, category: 'Khác', date: dkey(new Date()), note: '' })),
        })),
      removeTx: (id) => set((s) => ({ transactions: s.transactions.filter((x) => x.id !== id) })),

      upsertNote: (n) => {
        const id = n.id ?? uid()
        set((s) => ({
          notes: upsert(s.notes, { ...n, id, updatedAt: new Date().toISOString() }, () => ({ id, text: '', pinned: false, updatedAt: '' })),
        }))
        return id
      },
      removeNote: (id) => set((s) => ({ notes: s.notes.filter((x) => x.id !== id) })),

      upsertProject: (p) =>
        set((s) => ({ projects: upsert(s.projects, p, () => ({ id: '', title: 'Dự án mới', desc: '', status: 'idea', x: 50, y: 50 })) })),
      removeProject: (id) => set((s) => ({ projects: s.projects.filter((x) => x.id !== id) })),

      upsertIdea: (i) =>
        set((s) => ({
          ideas: upsert(s.ideas ?? [], { ...i, updatedAt: new Date().toISOString() }, () => ({
            id: '', title: '', script: '', stage: 'idea', updatedAt: '',
          })),
        })),
      removeIdea: (id) => set((s) => ({ ideas: (s.ideas ?? []).filter((x) => x.id !== id) })),

      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      importAll: (data) => set((s) => ({ ...s, ...data, ideas: data.ideas ?? [] })),
    }),
    { name: 'forest-data-v1' },
  ),
)

export const STATUS_LABEL: Record<Status, string> = { waiting: 'Chờ nhận', stock: 'Trong kho', posted: 'Đã đăng' }
