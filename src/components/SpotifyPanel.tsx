import { useEffect } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward, LogOut, LogIn, ExternalLink } from 'lucide-react'
import {
  SPOTIFY_ENABLED, connectPlayer, loadAccount, login, logout, playPlaylist, refreshPlaylists,
  spotifyNext, spotifyPrev, spotifyToggle, spotifyVolume, useSpotify,
} from '../lib/spotify'

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

export function SpotifyPanel() {
  const s = useSpotify()
  const isPremium = s.product === 'premium'

  // Khi đã đăng nhập: lấy loại tài khoản, rồi tải playlist (và trình phát nếu là Premium)
  useEffect(() => {
    if (s.loggedIn && !s.product && !s.checking) loadAccount()
  }, [s.loggedIn])

  useEffect(() => {
    if (!s.loggedIn || !s.product) return
    refreshPlaylists()
    if (isPremium) connectPlayer()
  }, [s.loggedIn, s.product])

  if (!SPOTIFY_ENABLED)
    return (
      <div className="glass panel">
        <h3><Music size={18} /> Spotify</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Chưa cấu hình. Thêm <code>VITE_SPOTIFY_CLIENT_ID=...</code> vào file <code>.env.local</code> rồi khởi động lại <code>npm run dev</code>.
        </p>
      </div>
    )

  if (!s.loggedIn)
    return (
      <div className="glass panel">
        <h3><Music size={18} /> Spotify</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Đăng nhập để xem playlist của bạn. Tài khoản Premium sẽ phát nhạc ngay trong Forest.
        </p>
        {s.error && <div className="tag red" style={{ display: 'block', marginBottom: 10, whiteSpace: 'normal' }}>{s.error}</div>}
        <button className="btn dark" onClick={() => login('#/relax')}><LogIn size={15} /> Đăng nhập Spotify</button>
      </div>
    )

  const header = (
    <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
      <h3 style={{ margin: 0 }} className="grow"><Music size={18} /> Spotify</h3>
      {s.product && (
        <span className={isPremium ? 'tag green' : 'tag'}>{isPremium ? 'Premium' : 'Free'}</span>
      )}
      {s.user && <span className="small muted">{s.user}</span>}
      <button className="btn ghost small" onClick={logout}><LogOut size={14} /> Đăng xuất</button>
    </div>
  )

  if (s.checking || !s.product)
    return (
      <div className="glass panel">
        {header}
        {s.error ? (
          <>
            <div className="tag red" style={{ display: 'block', marginBottom: 10, whiteSpace: 'normal' }}>
              Không lấy được tài khoản: {s.error}
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>
              Nếu ứng dụng Spotify đang ở chế độ Development, email tài khoản này phải được thêm trong
              mục User Management của app trên developer.spotify.com.
            </p>
            <button className="btn" onClick={loadAccount}>Thử lại</button>
          </>
        ) : (
          <div className="empty">Đang kiểm tra tài khoản…</div>
        )}
      </div>
    )

  const error = s.error && <div className="tag red" style={{ display: 'block', marginBottom: 10, whiteSpace: 'normal' }}>{s.error}</div>

  // ----- Premium: phát trực tiếp trong Forest -----
  if (isPremium)
    return (
      <div className="glass panel">
        {header}
        {error}
        <div className="card row" style={{ marginBottom: 14 }}>
          {s.track?.image
            ? <img src={s.track.image} alt="" width={44} height={44} style={{ borderRadius: 8, objectFit: 'cover' }} />
            : <div style={{ width: 44, height: 44, borderRadius: 8, background: 'rgba(0,0,0,.06)' }} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, ...ellipsis }}>
              {s.track?.name ?? (s.ready ? 'Chọn một playlist bên dưới' : 'Đang khởi tạo trình phát…')}
            </div>
            <div className="small muted">{s.track?.artist ?? ''}</div>
          </div>
          <button className="icon-btn" onClick={spotifyPrev} disabled={!s.ready} aria-label="Bài trước"><SkipBack size={16} /></button>
          <button className="icon-btn" onClick={spotifyToggle} disabled={!s.ready} aria-label="Phát / dừng">
            {s.paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <button className="icon-btn" onClick={spotifyNext} disabled={!s.ready} aria-label="Bài sau"><SkipForward size={16} /></button>
        </div>
        <input
          type="range" min={0} max={1} step={0.01} defaultValue={0.6}
          onChange={(e) => spotifyVolume(+e.target.value)}
          style={{ width: '100%', accentColor: 'var(--black)', marginBottom: 14 }}
          aria-label="Âm lượng Spotify"
        />
        <PlaylistList
          items={s.playlists}
          onPick={(p) => playPlaylist(p.uri)}
          disabled={!s.ready}
          emptyText="Chưa tải được playlist."
        />
        <p className="small muted" style={{ marginBottom: 0 }}>
          Nhạc Spotify phát riêng, không trộn chung với tiếng ồn trắng. Chỉnh âm lượng ở đây và ở mục Ồn trắng.
        </p>
      </div>
    )

  // ----- Free: không phát được trong Forest, mở playlist trên Spotify -----
  return (
    <div className="glass panel">
      {header}
      {error}
      <p className="small muted" style={{ marginTop: 0 }}>
        Tài khoản Free không phát được trực tiếp trong Forest. Bấm playlist để mở trên Spotify và nghe ở đó.
        Nâng lên Premium để phát ngay trong Forest.
      </p>
      <PlaylistList items={s.playlists} emptyText="Chưa tải được playlist." />
    </div>
  )
}

function PlaylistList({
  items, onPick, disabled, emptyText,
}: {
  items: { id: string; name: string; url: string; image?: string; count: number; uri: string }[]
  onPick?: (p: { uri: string }) => void
  disabled?: boolean
  emptyText: string
}) {
  return (
    <div className="list" style={{ maxHeight: 260, overflow: 'auto' }}>
      {items.map((p) => {
        const inner = (
          <>
            {p.image
              ? <img src={p.image} alt="" width={36} height={36} style={{ borderRadius: 6, objectFit: 'cover' }} />
              : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(0,0,0,.06)' }} />}
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, ...ellipsis }}>{p.name}</div>
              <div className="small muted">{p.count} bài</div>
            </div>
          </>
        )
        return onPick ? (
          <button key={p.id} className="card row" style={{ textAlign: 'left' }} onClick={() => onPick(p)} disabled={disabled}>
            {inner}
          </button>
        ) : (
          <a key={p.id} className="card row" href={p.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
            {inner}
            <ExternalLink size={14} className="muted" />
          </a>
        )
      })}
      {items.length === 0 && <div className="empty">{emptyText}</div>}
    </div>
  )
}
