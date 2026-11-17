/**
 * Đồng bộ đám mây bằng Supabase.
 * Quy tắc: bản sửa gần nhất thắng (last-write-wins) theo thời điểm.
 * - Mỗi lần sửa, dữ liệu được đẩy lên sau 1,5 giây (gom nhiều thay đổi thành một lần gửi).
 * - Khi mở app, khi quay lại tab, hoặc khi đăng nhập: so thời điểm rồi tải về hoặc đẩy lên.
 */
import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import { useStore } from '../store'
import { supabase } from './supabase'

export type SyncStatus = 'off' | 'signed-out' | 'idle' | 'syncing' | 'error'
export const useSync = create<{ status: SyncStatus; email?: string; name?: string; lastSyncedAt?: string; error?: string }>(() => ({
  status: supabase ? 'signed-out' : 'off',
}))

// Trạng thái đồng bộ lưu theo từng trình duyệt
const META_KEY = 'forest-sync-meta-v1'
interface Meta { remoteAt: number; dirtyAt: number }
const loadMeta = (): Meta => {
  try { return { remoteAt: 0, dirtyAt: 0, ...JSON.parse(localStorage.getItem(META_KEY) ?? '{}') } } catch { return { remoteAt: 0, dirtyAt: 0 } }
}
const saveMeta = (m: Meta) => { try { localStorage.setItem(META_KEY, JSON.stringify(m)) } catch { /* bỏ qua */ } }

const PICK = ['items', 'reminders', 'habits', 'transactions', 'notes', 'projects', 'settings', 'ideas'] as const
const snapshot = () => {
  const s = useStore.getState() as unknown as Record<string, unknown>
  return Object.fromEntries(PICK.map((k) => [k, s[k]]))
}

let userId: string | null = null
let applying = false
let timer: ReturnType<typeof setTimeout> | null = null

function schedulePush() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(pushNow, 1500)
}

/** Đẩy dữ liệu cục bộ lên Supabase */
export async function pushNow() {
  if (!supabase || !userId) return
  const dirtyAt = loadMeta().dirtyAt
  useSync.setState({ status: 'syncing' })
  const { data, error } = await supabase
    .from('forest_state')
    .upsert({ user_id: userId, data: snapshot(), updated_at: new Date().toISOString() })
    .select('updated_at')
    .single()
  if (error) return useSync.setState({ status: 'error', error: error.message })
  const m = loadMeta()
  m.remoteAt = Date.parse(data.updated_at)
  // chỉ xoá cờ "chưa đẩy" nếu không có thay đổi mới trong lúc đang gửi
  if (m.dirtyAt === dirtyAt) m.dirtyAt = 0
  saveMeta(m)
  useSync.setState({ status: 'idle', error: undefined, lastSyncedAt: new Date().toISOString() })
  if (m.dirtyAt) schedulePush()
}

/** So thời điểm rồi tải về hoặc đẩy lên */
async function reconcile() {
  if (!supabase || !userId) return
  useSync.setState({ status: 'syncing' })
  const { data, error } = await supabase
    .from('forest_state')
    .select('data, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return useSync.setState({ status: 'error', error: error.message })

  // Chưa có dữ liệu trên máy chủ: đẩy dữ liệu hiện có lên
  if (!data) return pushNow()

  const remoteAt = Date.parse(data.updated_at)
  const meta = loadMeta()
  if (meta.dirtyAt > 0 && meta.dirtyAt >= remoteAt) return pushNow() // sửa cục bộ mới hơn
  if (meta.dirtyAt === 0 && remoteAt <= meta.remoteAt) {
    return useSync.setState({ status: 'idle', error: undefined }) // đã đồng bộ rồi
  }

  // Bản trên máy chủ mới hơn: áp dụng vào app
  applying = true
  useStore.getState().importAll(data.data as Parameters<ReturnType<typeof useStore.getState>['importAll']>[0])
  applying = false
  saveMeta({ remoteAt, dirtyAt: 0 })
  useSync.setState({ status: 'idle', error: undefined, lastSyncedAt: new Date().toISOString() })
}

async function handleSession(session: Session | null) {
  if (!session) {
    userId = null
    return useSync.setState({ status: 'signed-out', email: undefined, name: undefined })
  }
  if (userId === session.user.id) return
  userId = session.user.id
  // Google trả tên trong user_metadata; nếu không có thì lấy phần trước @ của email
  const meta = session.user.user_metadata as { full_name?: string; name?: string } | undefined
  const name = meta?.full_name ?? meta?.name ?? session.user.email?.split('@')[0]
  useSync.setState({ email: session.user.email ?? undefined, name })
  await reconcile()
}

/** Gọi một lần khi app khởi động */
export async function initSync() {
  if (!supabase) return
  // mọi thay đổi dữ liệu (trừ lúc đang áp dữ liệu từ máy chủ) đều được đánh dấu để đẩy lên
  useStore.subscribe((s, prev) => {
    if (applying) return
    const changed = PICK.some((k) => (s as unknown as Record<string, unknown>)[k] !== (prev as unknown as Record<string, unknown>)[k])
    if (!changed) return
    const m = loadMeta()
    m.dirtyAt = Date.now()
    saveMeta(m)
    if (userId) schedulePush()
  })

  supabase.auth.onAuthStateChange((_event, session) => { void handleSession(session) })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && userId) void reconcile()
  })
  const { data } = await supabase.auth.getSession()
  await handleSession(data.session)
}

export async function signInWithGoogle() {
  if (!supabase) return
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/' },
  })
}

export async function signOutCloud() {
  await supabase?.auth.signOut()
}
