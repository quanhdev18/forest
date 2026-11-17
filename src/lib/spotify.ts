/**
 * Tích hợp Spotify (PKCE – không cần client secret, không cần máy chủ).
 * - Đăng nhập: chuyển hướng tới accounts.spotify.com, đổi code lấy token.
 * - Phát nhạc: Web Playback SDK tạo một "thiết bị" Forest trong trình duyệt (cần Premium).
 * - Dữ liệu token chỉ lưu trong localStorage của trình duyệt này.
 */
import { create } from 'zustand'

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined
export const SPOTIFY_ENABLED = !!CLIENT_ID

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
]
const TOKEN_KEY = 'forest-spotify-v1'
const VERIFIER_KEY = 'forest-spotify-verifier'
const RETURN_KEY = 'forest-spotify-return'

interface Tokens { access: string; refresh: string; expiresAt: number }
export interface Playlist { id: string; name: string; uri: string; url: string; image?: string; count: number }
export interface Track { name: string; artist: string; image?: string }
/** premium: phát trong Forest · free: chỉ mở playlist trên Spotify */
export type Product = 'premium' | 'free'

interface SpotifyState {
  loggedIn: boolean
  product?: Product
  user?: string
  checking: boolean
  ready: boolean
  paused: boolean
  track?: Track
  playlists: Playlist[]
  error?: string
}
export const useSpotify = create<SpotifyState>(() => ({
  loggedIn: !!loadTokens(),
  checking: false,
  ready: false,
  paused: true,
  playlists: [],
}))
const set = useSpotify.setState

// ---------- lưu token ----------
function loadTokens(): Tokens | null {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') } catch { return null }
}
function saveTokens(t: Tokens | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t))
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* chế độ riêng tư: bỏ qua */ }
}

// ---------- PKCE helpers ----------
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const randomVerifier = () => {
  const a = new Uint8Array(64)
  crypto.getRandomValues(a)
  return b64url(a)
}
const redirectUri = () => window.location.origin + '/'

/** Chuyển sang trang đăng nhập Spotify. `returnRoute` là trang quay lại sau khi xong (vd "#/relax"). */
export async function login(returnRoute = '#/relax') {
  if (!CLIENT_ID) return
  const verifier = randomVerifier()
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(RETURN_KEY, returnRoute)
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES.join(' '),
  })
  window.location.href = 'https://accounts.spotify.com/authorize?' + p.toString()
}

/** Gọi khi ứng dụng khởi động: nếu URL có ?code= từ Spotify thì đổi lấy token. */
export async function handleCallback(): Promise<void> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (!code || !CLIENT_ID) return
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  const ret = sessionStorage.getItem(RETURN_KEY) ?? '#/relax'
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(RETURN_KEY)
  window.history.replaceState({}, '', '/' + ret)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  if (!verifier) return set({ error: 'Phiên đăng nhập hết hạn, thử lại nhé.' })
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error('[Spotify] token exchange', r.status, body)
    return set({ error: `Đổi token thất bại (HTTP ${r.status}): ${body.slice(0, 160)}` })
  }
  const j = await r.json()
  saveTokens({ access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 })
  set({ loggedIn: true, error: undefined })
}

async function accessToken(): Promise<string> {
  const t = loadTokens()
  if (!t) throw new Error('Chưa đăng nhập Spotify')
  if (t.expiresAt - 60_000 > Date.now()) return t.access
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID!, grant_type: 'refresh_token', refresh_token: t.refresh }),
  })
  if (!r.ok) { logout(); throw new Error('Phiên Spotify đã hết hạn, hãy đăng nhập lại') }
  const j = await r.json()
  const next: Tokens = {
    access: j.access_token,
    refresh: j.refresh_token ?? t.refresh,
    expiresAt: Date.now() + j.expires_in * 1000,
  }
  saveTokens(next)
  return next.access
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T | null> {
  const token = await accessToken()
  const r = await fetch('https://api.spotify.com/v1' + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (r.status === 204) return null
  if (!r.ok) {
    const msg = await r.json().catch(() => null)
    const text = `${path} → HTTP ${r.status}: ${msg?.error?.message ?? 'không rõ'}`
    console.error('[Spotify]', text, msg)
    throw new Error(text)
  }
  return r.json()
}

// ---------- Web Playback SDK ----------
let player: any = null
let deviceId: string | null = null

function loadSdk(): Promise<void> {
  if ((window as any).Spotify) return Promise.resolve()
  return new Promise((resolve, reject) => {
    ;(window as any).onSpotifyWebPlaybackSDKReady = () => resolve()
    const s = document.createElement('script')
    s.src = 'https://sdk.scdn.co/spotify-player.js'
    s.onerror = () => reject(new Error('Không tải được Spotify SDK'))
    document.body.appendChild(s)
  })
}

/** Đọc loại tài khoản (Premium hay Free) từ /me */
export async function loadAccount() {
  if (!loadTokens()) return
  set({ checking: true })
  try {
    const me = await api('/me')
    set({
      product: me?.product === 'premium' ? 'premium' : 'free',
      user: me?.display_name ?? undefined,
      checking: false,
    })
  } catch (e: any) {
    set({ checking: false, error: e.message })
  }
}

export async function connectPlayer() {
  // Free không phát được trong trình duyệt, nên không khởi tạo trình phát
  if (!loadTokens() || player || useSpotify.getState().product !== 'premium') return
  try {
    await loadSdk()
    const S = (window as any).Spotify
    player = new S.Player({
      name: 'Forest',
      volume: 0.6,
      getOAuthToken: (cb: (t: string) => void) => accessToken().then(cb).catch(() => cb('')),
    })
    player.addListener('ready', ({ device_id }: { device_id: string }) => {
      deviceId = device_id
      set({ ready: true, error: undefined })
      refreshPlaylists()
    })
    player.addListener('not_ready', () => { deviceId = null; set({ ready: false }) })
    player.addListener('player_state_changed', (st: any) => {
      if (!st) return
      const t = st.track_window?.current_track
      set({
        paused: st.paused,
        track: t ? { name: t.name, artist: t.artists.map((a: any) => a.name).join(', '), image: t.album.images?.[0]?.url } : undefined,
      })
    })
    const errs = ['initialization_error', 'authentication_error', 'account_error', 'playback_error']
    errs.forEach((e) => player.addListener(e, ({ message }: { message: string }) => set({ error: message })))
    player.addListener('account_error', () => set({ error: 'Cần tài khoản Spotify Premium để phát trong trình duyệt' }))
    await player.connect()
  } catch (e: any) {
    set({ error: e?.message ?? 'Lỗi khởi tạo Spotify' })
  }
}

export async function refreshPlaylists() {
  try {
    const j = await api('/me/playlists?limit=30')
    set({
      playlists: (j?.items ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        uri: p.uri,
        url: p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`,
        image: p.images?.[0]?.url,
        count: p.tracks?.total ?? 0,
      })),
    })
  } catch (e: any) {
    set({ error: e.message })
  }
}

/** Phát một playlist trên thiết bị Forest */
export async function playPlaylist(uri: string) {
  if (!deviceId) return set({ error: 'Trình phát chưa sẵn sàng' })
  try {
    await api(`/me/player/play?device_id=${deviceId}`, { method: 'PUT', body: JSON.stringify({ context_uri: uri }) })
    set({ error: undefined })
  } catch (e: any) {
    set({ error: e.message })
  }
}

export const spotifyToggle = () => player?.togglePlay()
export const spotifyNext = () => player?.nextTrack()
export const spotifyPrev = () => player?.previousTrack()
export const spotifyVolume = (v: number) => player?.setVolume(v)

export function logout() {
  saveTokens(null)
  player?.disconnect()
  player = null
  deviceId = null
  set({ loggedIn: false, product: undefined, user: undefined, ready: false, paused: true, track: undefined, playlists: [] })
}
