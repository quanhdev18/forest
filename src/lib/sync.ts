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
import { logout as spotifyLogout } from './spotify'
import { useToasts } from '../components/ui'

// checking: đang đọc phiên đăng nhập lúc mở app (chưa biết đã đăng nhập hay chưa)
export type SyncStatus = 'off' | 'checking' | 'signed-out' | 'idle' | 'syncing' | 'error'
export const useSync = create<{ status: SyncStatus; email?: string; name?: string; lastSyncedAt?: string; error?: string }>(() => ({
  status: supabase ? 'checking' : 'off',
}))

// Trạng thái đồng bộ lưu theo từng trình duyệt
const META_KEY = 'forest-sync-meta-v1'
interface Meta { remoteAt: number; dirtyAt: number }
const loadMeta = (): Meta => {
  try { return { remoteAt: 0, dirtyAt: 0, ...JSON.parse(localStorage.getItem(META_KEY) ?? '{}') } } catch { return { remoteAt: 0, dirtyAt: 0 } }
}
const saveMeta = (m: Meta) => { try { localStorage.setItem(META_KEY, JSON.stringify(m)) } catch { /* bỏ qua */ } }

// Dữ liệu trên trình duyệt thuộc tài khoản nào (id người dùng Supabase).
// Dùng để không bao giờ đẩy dữ liệu của tài khoản A lên tài khoản B khi dùng chung một máy.
const OWNER_KEY = 'forest-owner-v1'
const getOwner = () => { try { return localStorage.getItem(OWNER_KEY) } catch { return null } }
const setOwner = (id: string | null) => {
  try { if (id) localStorage.setItem(OWNER_KEY, id); else localStorage.removeItem(OWNER_KEY) } catch { /* bỏ qua */ }
}

/** Xoá dữ liệu trên máy, về dữ liệu mẫu (không đánh dấu là "đã sửa" để không bị đẩy lên) */
function clearLocalData() {
  applying = true
  useStore.getState().resetAll()
  applying = false
  saveMeta({ remoteAt: 0, dirtyAt: 0 })
}

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
    const was = userId
    userId = null
    // vừa bị đăng xuất (ở tab khác, hoặc phiên hết hạn): nếu đã đồng bộ hết thì xoá dữ liệu khỏi máy;
    // còn thay đổi chưa đồng bộ thì giữ lại, chủ sở hữu vẫn là tài khoản cũ (đăng nhập lại sẽ đẩy lên)
    if (was) {
      if (!loadMeta().dirtyAt) { clearLocalData(); setOwner(null) }
      else setOwner(was)
    }
    return useSync.setState({ status: 'signed-out', email: undefined, name: undefined })
  }
  if (userId === session.user.id) return
  userId = session.user.id
  // Dữ liệu trên máy đang là của tài khoản khác -> bỏ đi, tải dữ liệu của tài khoản này về
  const owner = getOwner()
  if (owner && owner !== userId) clearLocalData()
  setOwner(userId)
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

/** Chuyển sang trang đăng nhập Google. Trả về thông báo lỗi nếu không mở được. */
export async function signInWithGoogle(): Promise<string | null> {
  if (!supabase) return 'Chưa cấu hình Supabase'
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/', queryParams: { prompt: 'select_account' } },
  })
  return error ? error.message : null
}

/**
 * Đăng xuất: đẩy nốt thay đổi chưa đồng bộ, rồi xoá dữ liệu của tài khoản khỏi trình duyệt
 * (để người dùng sau trên cùng máy không thấy được). Đăng nhập lại sẽ tải về từ đám mây.
 */
export async function signOutCloud() {
  if (!supabase) return
  if (userId && loadMeta().dirtyAt) {
    if (timer) clearTimeout(timer)
    await pushNow()
    if (loadMeta().dirtyAt) {
      useToasts.getState().push('Chưa đồng bộ được thay đổi mới nhất. Kiểm tra mạng rồi đăng xuất lại để không mất dữ liệu.', 'error')
      return
    }
  }
  // scope 'local': chỉ đăng xuất trình duyệt này (mặc định của Supabase là đăng xuất MỌI thiết bị)
  await supabase.auth.signOut({ scope: 'local' })
  userId = null
  clearLocalData()
  setOwner(null)
  spotifyLogout() // tài khoản Spotify đang kết nối cũng ngắt khỏi trình duyệt này
}
