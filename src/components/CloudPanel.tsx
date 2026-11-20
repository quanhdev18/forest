import { Cloud, CloudOff, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { pushNow, signInWithGoogle, signOutCloud, useSync } from '../lib/sync'
import { CLOUD_ENABLED } from '../lib/supabase'
import { fmt } from '../lib/utils'

export function CloudPanel() {
  const s = useSync()

  const statusText = {
    off: 'Chưa cấu hình Supabase',
    checking: 'Đang kiểm tra đăng nhập…',
    'signed-out': 'Chưa đăng nhập. Dữ liệu chỉ lưu trên máy này.',
    idle: 'Đã đồng bộ',
    syncing: 'Đang đồng bộ…',
    error: 'Lỗi đồng bộ',
  }[s.status]

  return (
    <div className="glass panel">
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }} className="grow">
          {s.status === 'off' ? <CloudOff size={18} /> : <Cloud size={18} />} Tài khoản & đồng bộ
        </h3>
        {s.email && <span className="small muted">{s.email}</span>}
      </div>

      {!CLOUD_ENABLED && (
        <p className="small muted" style={{ marginTop: 0 }}>
          Thêm <code>VITE_SUPABASE_URL</code> và <code>VITE_SUPABASE_ANON_KEY</code> vào <code>.env.local</code>, rồi khởi động lại app.
        </p>
      )}

      <p className="small" style={{ marginTop: 0 }}>
        {statusText}
        {s.lastSyncedAt && <span className="muted"> · lần cuối {fmt(s.lastSyncedAt, 'HH:mm dd/MM')}</span>}
      </p>
      {s.error && <div className="tag red" style={{ display: 'block', marginBottom: 10, whiteSpace: 'normal' }}>{s.error}</div>}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        {s.status === 'signed-out' && (
          <button className="btn dark" onClick={() => void signInWithGoogle()}><LogIn size={15} /> Đăng nhập bằng Google</button>
        )}
        {s.status !== 'signed-out' && s.status !== 'off' && s.status !== 'checking' && (
          <>
            <button className="btn" onClick={pushNow} disabled={s.status === 'syncing'}>
              <RefreshCw size={15} /> Đồng bộ ngay
            </button>
            <button className="btn ghost" onClick={signOutCloud}><LogOut size={15} /> Đăng xuất</button>
          </>
        )}
      </div>
    </div>
  )
}
