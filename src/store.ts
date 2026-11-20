import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { dkey, uid } from './lib/utils'
import type { AlarmSound } from './lib/noise'

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
  /** dự án của khoản thu/chi; trống = nhập riêng, không thuộc dự án */
  projectId?: string
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
  /** KPI: số video cần đăng mỗi tháng (0 / trống = không đặt KPI) */
  kpiVideos?: number
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
  /** âm báo nhắc việc */
  alarmSound?: AlarmSound
  /** true: kêu 3 lần; false: kêu 1 lần */
  alarmRepeat?: boolean
}

/** Tỷ giá USD → VND lấy tự động (xem lib/fx.ts). usdVnd = 0 nghĩa là chưa lấy được lần nào. */
export interface Fx {
  usdVnd: number
  updatedAt: string // ISO datetime: thời điểm nguồn cập nhật tỷ giá
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
  fx: Fx

  setFx: (f: Partial<Fx>) => void

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
  /** Về dữ liệu mẫu ban đầu (dùng khi đăng xuất / đổi tài khoản trên cùng trình duyệt) */
  resetAll: () => void
}

function upsert<T extends { id: string }>(list: T[], patch: Partial<T> & { id?: string }, make: () => T): T[] {
  if (patch.id && list.some((x) => x.id === patch.id)) {
    return list.map((x) => (x.id === patch.id ? { ...x, ...patch } : x))
  }
  return [...list, { ...make(), ...patch, id: patch.id ?? uid() }]
}

// Dữ liệu ban đầu: trống. Người dùng mới, hoặc sau khi đăng xuất, không thấy dữ liệu của ai.
const seed = {
  items: [] as ContentItem[],
  reminders: [] as Reminder[],
  habits: [] as Habit[],
  transactions: [] as Transaction[],
  notes: [] as Note[],
  projects: [] as Project[],
  ideas: [] as Idea[],
}

const defaultSettings: Settings = { blur: 18, glass: 0.55, accent: '#6b1a24', scene: 'forest', alarmSound: 'bell', alarmRepeat: false }

export const useStore = create<State>()(
  persist(
    (set) => ({
      ...seed,
      settings: defaultSettings,
      fx: { usdVnd: 0, updatedAt: '' },

      setFx: (f) => set((s) => ({ fx: { ...s.fx, ...f } })),

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
      resetAll: () => set({ ...seed, settings: defaultSettings }),
    }),
    { name: 'forest-data-v1' },
  ),
)

export const STATUS_LABEL: Record<Status, string> = { waiting: 'Chờ nhận', stock: 'Trong kho', posted: 'Đã đăng' }
