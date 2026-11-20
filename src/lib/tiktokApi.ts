import { supabase } from './supabase'

// Kênh đang chọn (khi được chia sẻ nhiều kênh) — lưu theo trình duyệt
const CHANNEL_KEY = 'forest-tiktok-channel'
export const getActiveChannel = () => { try { return localStorage.getItem(CHANNEL_KEY) } catch { return null } }
export const setActiveChannel = (ownerId: string) => { try { localStorage.setItem(CHANNEL_KEY, ownerId) } catch { /* bỏ qua */ } }

// Gọi /api/tiktok?action=...; gửi kèm token đăng nhập Supabase để server biết là ai
export async function api<T>(action: string, init: RequestInit = {}, query = ''): Promise<T> {
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined
  if (!token) throw new Error('Cần đăng nhập Google trong Forest để dùng mục Đăng TikTok')
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  const channel = getActiveChannel()
  if (channel) headers['x-tiktok-channel'] = channel
  if (typeof init.body === 'string') headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`/api/tiktok?action=${action}${query}`, { ...init, headers })
  } catch {
    throw new Error('Không kết nối được API Đăng TikTok, kiểm tra mạng rồi thử lại')
  }
  const text = await res.text()
  let body: { error?: string } = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { error: text.slice(0, 200) } }
  if (res.status === 401 && supabase) {
    // phiên bị thu hồi (vd đăng xuất ở nơi khác): hỏi lại Supabase; phiên chết thì app tự về trang đăng nhập
    void supabase.auth.getUser()
  }
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body as T
}

// Tải một file thẳng lên R2 bằng link ký sẵn (XHR để có % tiến độ)
export const putFile = (url: string, file: File, onProgress: (loaded: number) => void) =>
  new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('PUT', url)
    x.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    x.upload.onprogress = (e) => onProgress(e.loaded)
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`R2 từ chối file ${file.name} (${x.status})`)))
    x.onerror = () => reject(new Error('Không tải được file lên R2 (kiểm tra mạng hoặc cấu hình CORS của bucket)'))
    x.send(file)
  })

export type Privacy = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY'
export const PRIVACY_OPTIONS: { value: Privacy; label: string; hint: string }[] = [
  { value: 'PUBLIC_TO_EVERYONE', label: '🌍 Công khai', hint: 'Mọi người đều xem được bài này.' },
  { value: 'MUTUAL_FOLLOW_FRIENDS', label: '👥 Bạn bè', hint: 'Chỉ những người bạn follow lại (bạn bè) xem được.' },
  { value: 'SELF_ONLY', label: '🔒 Chỉ mình tôi', hint: 'Chỉ bạn xem được. Có thể đổi sang công khai trong app TikTok.' },
]

/** Cài đặt đăng TikTok của tài khoản (GET/POST ?action=settings) */
export interface TikTokSettings {
  privacy: Privacy
  allow_comment: boolean
  allow_duet: boolean
  allow_stitch: boolean
  auto_music: boolean
  photo_auto_music: boolean
  cover_ms: number
  is_aigc: boolean
  commercial: ('YOUR_BRAND' | 'BRANDED_CONTENT')[]
  key_masked: string | null
  key_source: 'own' | 'server' | 'none' | 'shared'
  role: 'owner' | 'member' // chủ kênh hay thành viên được chia sẻ
  channel: Channel
  channels: Channel[]
  members: string[] // email được chia sẻ (chỉ chủ kênh thấy)
  sharing_enabled: boolean // server có khoá service role để thành viên dùng được kênh
  ai_enabled: boolean // được dùng AI viết caption
  dry_run: boolean
}
export interface Channel { owner_id: string; owner_email: string; own: boolean }
