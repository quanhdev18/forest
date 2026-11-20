import { useState } from 'react'
import { CalendarDays, CircleDollarSign, Flame, Loader2, Lock, Send, Trees } from 'lucide-react'
import { signInWithGoogle } from '../lib/sync'
import { authUrlError } from '../lib/supabase'

// Trang đăng nhập: hiện khi chưa đăng nhập. Chỉ có đăng nhập bằng Google (Supabase Auth).

const FEATURES = [
  { icon: CalendarDays, text: 'Lịch quay, hạn đăng và booking với brand' },
  { icon: Flame, text: 'Thói quen, nhắc việc và ghi chú nhanh' },
  { icon: CircleDollarSign, text: 'Thu chi theo tháng, tỷ giá USD → VND' },
  { icon: Send, text: 'Lên lịch đăng TikTok tự động' },
]

/** Logo Google 4 màu (theo hướng dẫn nút "Sign in with Google") */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

export default function Login() {
  const [busy, setBusy] = useState(false)
  // lỗi khi quay về từ Google (bị huỷ, bị từ chối…) được đọc sẵn lúc tải trang
  const [error, setError] = useState<string | null>(authUrlError)

  const login = async () => {
    setBusy(true)
    setError(null)
    const err = await signInWithGoogle()
    // thành công thì trình duyệt đã chuyển sang trang Google; chỉ quay lại đây khi có lỗi
    if (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-card glass">
        <div className="login-brand">
          <span className="login-logo"><Trees size={30} /></span>
          <span className="login-name">Forest</span>
        </div>
        <h1 className="login-title">Chào mừng trở lại</h1>
        <p className="login-sub">Không gian quản lý nội dung và cuộc sống của bạn.</p>

        <ul className="login-features">
          {FEATURES.map((f) => (
            <li key={f.text}><f.icon size={16} /> {f.text}</li>
          ))}
        </ul>

        <button className="login-google" onClick={() => void login()} disabled={busy}>
          {busy ? <Loader2 size={18} className="spin" /> : <GoogleLogo />}
          {busy ? 'Đang mở Google…' : 'Tiếp tục với Google'}
        </button>

        {error && <div className="login-error" role="alert">Không đăng nhập được: {error}</div>}

        <p className="login-note">
          <Lock size={13} /> Dữ liệu được lưu riêng cho tài khoản của bạn và đồng bộ trên mọi thiết bị.
        </p>
      </div>
    </div>
  )
}

/** Màn chờ trong lúc kiểm tra phiên đăng nhập (tránh nháy trang đăng nhập) */
export function AuthSplash() {
  return (
    <div className="login">
      <div className="login-splash">
        <span className="login-logo"><Trees size={30} /></span>
        <Loader2 size={20} className="spin" />
      </div>
    </div>
  )
}
