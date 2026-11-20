import { createClient, SupabaseClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const CLOUD_ENABLED = !!(URL && ANON)

/**
 * Lỗi Google/Supabase trả về trên địa chỉ trang khi đăng nhập thất bại hoặc bị huỷ.
 * Phải đọc TRƯỚC khi tạo client: Supabase tự xoá các tham số này khỏi địa chỉ khi khởi động.
 */
function takeAuthUrlError(): string | null {
  if (typeof window === 'undefined') return null
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''))
  const desc = query.get('error_description') || hash.get('error_description') || query.get('error') || hash.get('error')
  if (!desc) return null
  window.history.replaceState(null, '', window.location.pathname) // tải lại trang không báo lỗi lần nữa
  return desc.replace(/\+/g, ' ')
}
export const authUrlError = takeAuthUrlError()

/** Khách Supabase dùng chung; null nếu chưa cấu hình .env.local */
export const supabase: SupabaseClient | null = CLOUD_ENABLED
  ? createClient(URL!, ANON!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null
