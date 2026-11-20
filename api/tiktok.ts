// API trang "Đăng TikTok". Chạy trên Vercel (Vercel Function) và khi dev ở máy (Vite gọi thẳng file này).
//
// - File video/ảnh: trình duyệt tải THẲNG lên Cloudflare R2 bằng link ký sẵn, không đi qua Vercel
//   (Vercel chỉ nhận request ~4,5 MB). Bảng chỉ lưu key của file trên R2.
// - Hàng đợi + mẫu nội dung: bảng Supabase (supabase/tiktok.sql), RLS: mỗi người chỉ thấy của mình.
// - Đăng: lấy file từ R2 rồi gửi QPost kèm giờ đăng (scheduledFor). QPost tự đăng đúng giờ, không cần máy bật.
// - Trạng thái/link bài được đồng bộ mỗi khi mở trang (không cần cron).
// - Chỉ email trong TIKTOK_ALLOWED_EMAILS được dùng, vì key QPost/Gemini là của chủ app.
//
// Gọi: /api/tiktok?action=posts|upload-url|retry|generate|templates[&id=...]

import { AwsClient } from 'aws4fetch'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import Anthropic from '@anthropic-ai/sdk'

const env = (k: string) => process.env[k] ?? ''

const MAX_IMAGES = 35
const MAX_VIDEO_BYTES = 500 * 1024 * 1024 // file phải nằm gọn trong bộ nhớ function khi gửi QPost
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const SOON_MS = 60_000 // giờ đăng trong vòng 1 phút tới (hoặc đã qua) thì đăng ngay
const STUCK_MS = 10 * 60_000 // 'posting' quá 10 phút = function bị ngắt giữa chừng
const HASHTAG_COUNT = 5

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------- đăng nhập + quyền
// Kênh = tài khoản TikTok gắn với key QPost của một người. MỌI tài khoản đều có kênh riêng (nhập key QPost của mình).
// Chủ kênh thêm email thành viên (bảng tiktok_members); thành viên đăng lên kênh đó nhưng không thấy key.
// TIKTOK_ALLOWED_EMAILS: những email được dùng key QPost chung trên server và AI viết caption (key Gemini của chủ app).
interface Channel { owner_id: string; owner_email: string; own: boolean }
interface Ctx {
  db: SupabaseClient // client mang token người dùng (qua RLS)
  userId: string
  email: string
  channels: Channel[] // các kênh người này được dùng
  channel: Channel // kênh đang chọn
  settingsCache?: Map<string, Settings> // cài đặt theo chủ kênh, trong một request
}

const supabaseUrl = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL')
const allowedOwners = () => env('TIKTOK_ALLOWED_EMAILS').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
/** email này có được dùng key QPost chung trên server + AI của chủ app không */
const isPrivileged = (email: string) => allowedOwners().includes(email.toLowerCase())

// Client quyền quản trị (bỏ qua RLS) — chỉ dùng trên server để đọc kênh được chia sẻ. Không có khoá thì tắt chia sẻ.
let adminClient: SupabaseClient | null = null
function adminDb(): SupabaseClient | null {
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!key || !supabaseUrl()) return null
  adminClient ??= createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } })
  return adminClient
}

// Các kênh người khác chia sẻ cho email này
async function sharedChannels(email: string, userId: string): Promise<Channel[]> {
  const adm = adminDb()
  if (!adm) return []
  const { data, error } = await adm.from('tiktok_members').select('owner_id').eq('member_email', email)
  if (error) {
    if (!tableMissing(error)) console.error('[tiktok] đọc tiktok_members lỗi:', error.message)
    return []
  }
  const owners = [...new Set((data ?? []).map((r) => r.owner_id as string))].filter((id) => id !== userId)
  const out: Channel[] = []
  for (const id of owners) {
    const { data: u } = await adm.auth.admin.getUserById(id)
    const ownerEmail = (u.user?.email ?? '').toLowerCase()
    if (ownerEmail) out.push({ owner_id: id, owner_email: ownerEmail, own: false })
  }
  return out
}

async function auth(req: Request): Promise<Ctx> {
  const url = supabaseUrl()
  const anon = env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY')
  if (!url || !anon) throw new HttpError(500, 'Thiếu cấu hình Supabase trên server')
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Cần đăng nhập Google trong Forest để dùng mục Đăng TikTok')

  // client mang token của người dùng -> mọi truy vấn đều qua RLS của họ
  const db = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) {
    // lỗi mạng / Supabase quá tải không phải là hết phiên: báo đúng để người dùng không đăng nhập lại vô ích
    const status = (error as { status?: number } | null)?.status
    console.error('[tiktok] getUser lỗi:', status, error?.name, error?.message)
    if (!status || status >= 500) throw new HttpError(503, 'Không kiểm tra được đăng nhập (lỗi kết nối Supabase), thử lại sau')
    throw new HttpError(401, 'Phiên đăng nhập hết hạn, hãy đăng nhập lại')
  }

  const userId = data.user.id
  const email = (data.user.email ?? '').toLowerCase()
  // kênh của chính mình luôn có; thêm các kênh người khác chia sẻ
  const channels: Channel[] = [{ owner_id: userId, owner_email: email, own: true }, ...(await sharedChannels(email, userId))]
  // kênh đang chọn: trình duyệt gửi qua header x-tiktok-channel; không hợp lệ thì lấy kênh đầu tiên
  const want = req.headers.get('x-tiktok-channel')
  const channel = channels.find((c) => c.owner_id === want) ?? channels[0]
  return { db, userId, email, channels, channel }
}

// ---------------------------------------------------------------- Cloudflare R2 (S3)
let r2: AwsClient | null = null
function r2Client() {
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    if (!env(k)) throw new HttpError(500, `Server chưa cấu hình ${k}`)
  }
  r2 ??= new AwsClient({
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: 'auto',
  })
  return r2
}
const objectUrl = (key: string) =>
  `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_BUCKET')}/${key.split('/').map(encodeURIComponent).join('/')}`

async function presign(key: string, method: 'GET' | 'PUT', seconds: number) {
  const req = new Request(`${objectUrl(key)}?X-Amz-Expires=${seconds}`, { method })
  return (await r2Client().sign(req, { aws: { signQuery: true } })).url
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}
const fileName = (key: string) => key.split('/').pop() ?? 'file'

async function getObject(key: string): Promise<Blob> {
  const res = await r2Client().fetch(objectUrl(key))
  if (!res.ok) throw new Error(`Không đọc được file trên R2 (${res.status}): ${fileName(key)}`)
  const buf = await res.arrayBuffer()
  const type = res.headers.get('content-type') || MIME[fileName(key).split('.').pop()?.toLowerCase() ?? ''] || ''
  return new Blob([buf], { type })
}

async function deleteObjects(keys: string[]) {
  const c = r2Client()
  await Promise.all(keys.map((k) => c.fetch(objectUrl(k), { method: 'DELETE' }).catch(() => null)))
}

// ---------------------------------------------------------------- QPost (https://qpost.dev/docs/)
const QPOST_BASE = () => (env('QPOST_BASE_URL') || 'https://qpost.dev').replace(/\/$/, '')
const DRY = () => env('QPOST_DRY_RUN') !== 'false'

class QPostError extends Error {
  constructor(public status: number, public code: string, message: string, public body: unknown) {
    super(message)
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function qpost(key: string, method: string, path: string, body?: FormData): Promise<any> {
  if (!key) throw new HttpError(400, 'Chưa có API key QPost — nhập key trong mục Cài đặt của trang Đăng TikTok')
  const res = await fetch(QPOST_BASE() + path, {
    method,
    headers: { 'x-api-key': key },
    body,
    signal: AbortSignal.timeout(4 * 60_000),
  })
  const text = await res.text()
  let j: any
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  if (!res.ok) {
    const msg = res.status === 401
      ? 'QPost 401: API key không đúng hoặc đã bị xoá'
      : `QPost ${res.status}: ${String(j.error || j.message || j.code || text).slice(0, 300)}`
    throw new QPostError(res.status, String(j.code ?? ''), msg, j)
  }
  return j
}

// Docs QPost không ghi rõ cấu trúc JSON trả về nên đọc kiểu "dò tìm"
const pickId = (j: any) => j?.id ?? j?.post?.id ?? j?.data?.id ?? j?.data?.post?.id ?? j?.postId ?? null
function pickStatus(j: any): string | null {
  const p = j?.post ?? j?.data?.post ?? j?.data ?? j
  return String(p?.status ?? '').toUpperCase() || null
}
function pickTikTokUrl(j: any): string | null {
  let found: string | null = null
  ;(function walk(v: any) {
    if (found || v == null) return
    if (typeof v === 'string') {
      if (/^https?:\/\/(www\.|vm\.|m\.)?tiktok\.com\//.test(v)) found = v
      return
    }
    if (typeof v === 'object') Object.values(v).forEach(walk)
  })(j)
  return found
}
function pickError(j: any): string | null {
  let found: string | null = null
  ;(function walk(v: any, k?: string) {
    if (found || v == null) return
    if (typeof v === 'string' && /error|reason|message/i.test(k || '') && v) { found = v; return }
    if (typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk)
  })(j)
  return found
}

interface SendInput {
  mediaType: 'video' | 'images'
  keys: string[]
  caption: string
  title: string
  coverMs: number | null
  privacy: string | null
  scheduledFor?: string
}

async function createTikTokPost(p: SendInput, s: Settings): Promise<{ qpostId: unknown; status: string | null; url: string | null }> {
  if (DRY()) return { qpostId: `dry-${Date.now()}`, status: null, url: null }

  const isImages = p.mediaType === 'images'
  const privacyLevel = p.privacy || s.privacy
  const commercial = s.commercial
  if (commercial.includes('BRANDED_CONTENT') && privacyLevel === 'SELF_ONLY') {
    throw new Error('BRANDED_CONTENT không được để Chỉ mình tôi, hãy chọn Công khai')
  }

  const form = new FormData()
  const blobs = await Promise.all(p.keys.map(getObject))
  blobs.forEach((b, i) => form.append(isImages ? 'images' : 'video', b, fileName(p.keys[i])))
  form.append('caption', p.caption)
  if (p.title) form.append('title', p.title)
  if (p.scheduledFor) {
    form.append('scheduledFor', new Date(p.scheduledFor).toISOString())
    form.append('timezone', 'UTC')
  }
  form.append('platforms', JSON.stringify([{
    platform: 'TIKTOK',
    metadata: {
      privacyLevel,
      allowComment: s.allow_comment,
      allowDuet: s.allow_duet,
      allowStitch: s.allow_stitch,
      // bài ảnh: TikTok tự chọn nhạc; video: giữ tiếng gốc (trừ khi bật tự thêm nhạc)
      autoAddMusic: isImages ? s.photo_auto_music : s.auto_music,
      videoCoverTimestampMs: Number.isInteger(p.coverMs) ? p.coverMs : s.cover_ms,
      commercialContentEnabled: commercial.length > 0,
      commercialContentSelections: commercial,
      isAigc: s.is_aigc,
    },
  }]))

  const j = await qpost(qpostKey(s), 'POST', '/api/post', form)
  return { qpostId: pickId(j), status: pickStatus(j), url: pickTikTokUrl(j) }
}

async function getPublicUrl(key: string, qpostId: string): Promise<string | null> {
  if (DRY()) return null
  try {
    const s = await qpost(key, 'GET', `/api/post/${encodeURIComponent(qpostId)}/stats`)
    const t = (s?.platforms || []).find((x: any) => x.platform === 'TIKTOK')
    return t?.postUrl || pickTikTokUrl(s)
  } catch {
    return null
  }
}

async function getPostResult(key: string, qpostId: string): Promise<{ status: string | null; url: string | null; error: string | null }> {
  if (DRY()) return { status: 'POSTED', url: `https://www.tiktok.com/@demo/video/${qpostId.replace(/\D/g, '')}`, error: null }
  const j = await qpost(key, 'GET', `/api/post/${encodeURIComponent(qpostId)}`)
  const status = pickStatus(j)
  const tiktok = (j?.post?.platforms || []).find((x: any) => x.platform === 'TIKTOK')
  let url = pickTikTokUrl(j)
  if (status === 'POSTED' && !url) url = await getPublicUrl(key, qpostId)
  const error = status === 'FAILED' ? tiktok?.errorMessage || pickError(j) || 'QPost báo FAILED' : null
  return { status, url, error }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- cài đặt của từng người
const PRIVACIES = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY']
const COMMERCIAL = ['YOUR_BRAND', 'BRANDED_CONTENT']

interface Settings {
  qpost_api_key: string | null
  privacy: string
  allow_comment: boolean
  allow_duet: boolean
  allow_stitch: boolean
  auto_music: boolean
  photo_auto_music: boolean
  cover_ms: number
  is_aigc: boolean
  commercial: string[]
  server_key_ok: boolean // chủ kênh nằm trong TIKTOK_ALLOWED_EMAILS -> được dùng key QPost chung khi chưa có key riêng
}

// Chưa lưu cài đặt thì dùng giá trị trong biến môi trường của server (giống bản cũ)
const envSettings = (): Settings => ({
  qpost_api_key: null,
  server_key_ok: false,
  privacy: PRIVACIES.includes(env('TIKTOK_PRIVACY')) ? env('TIKTOK_PRIVACY') : 'PUBLIC_TO_EVERYONE',
  allow_comment: env('TIKTOK_ALLOW_COMMENT') !== 'false',
  allow_duet: env('TIKTOK_ALLOW_DUET') === 'true',
  allow_stitch: env('TIKTOK_ALLOW_STITCH') === 'true',
  auto_music: env('TIKTOK_AUTO_MUSIC') === 'true',
  photo_auto_music: env('TIKTOK_PHOTO_AUTO_MUSIC') !== 'false',
  cover_ms: Number(env('TIKTOK_COVER_MS') || 1000),
  is_aigc: env('TIKTOK_IS_AIGC') === 'true',
  commercial: env('TIKTOK_COMMERCIAL').split(',').map((s) => s.trim().toUpperCase()).filter((s) => COMMERCIAL.includes(s)),
})

/** key QPost dùng để đăng: key riêng của kênh; chỉ kênh của email được phép mới dùng key chung trên server */
const qpostKey = (s: Settings) => s.qpost_api_key || (s.server_key_ok ? env('QPOST_API_KEY') : '')

const tableMissing = (e: { code?: string; message?: string }) =>
  e.code === '42P01' || e.code === 'PGRST205' || /could not find the table/i.test(e.message ?? '')

const SETTINGS_COLS = 'qpost_api_key,privacy,allow_comment,allow_duet,allow_stitch,auto_music,photo_auto_music,cover_ms,is_aigc,commercial'

/** Cài đặt (kèm key QPost) của một kênh. Kênh của mình đọc qua RLS; kênh được chia sẻ đọc bằng client quản trị. */
async function settingsFor(ctx: Ctx, ownerId: string): Promise<Settings> {
  ctx.settingsCache ??= new Map()
  const hit = ctx.settingsCache.get(ownerId)
  if (hit) return hit
  const own = ownerId === ctx.userId
  const ch = ctx.channels.find((c) => c.owner_id === ownerId)
  if (!ch) throw new HttpError(403, 'Bạn không còn quyền dùng kênh này')
  const client = own ? ctx.db : adminDb()
  if (!client) throw new HttpError(500, 'Server chưa cấu hình SUPABASE_SERVICE_ROLE_KEY nên chưa dùng được kênh được chia sẻ')
  const { data, error } = await client.from('tiktok_settings').select(SETTINGS_COLS).eq('user_id', ownerId).maybeSingle()
  if (error && !tableMissing(error)) throw new Error(error.message)
  const row = data as (Partial<Settings> & { commercial?: string[] | null }) | null
  const s: Settings = {
    ...envSettings(),
    ...(row ?? {}),
    commercial: row?.commercial ?? envSettings().commercial,
    server_key_ok: isPrivileged(ch.owner_email),
  }
  ctx.settingsCache.set(ownerId, s)
  return s
}
const getSettings = (ctx: Ctx) => settingsFor(ctx, ctx.channel.owner_id)

const maskKey = (k: string) => (k.length <= 8 ? '••••' : `${k.slice(0, 3)}••••${k.slice(-4)}`)

async function listMembers(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.db.from('tiktok_members').select('member_email').eq('owner_id', ctx.userId).order('created_at')
  if (error) {
    if (tableMissing(error)) return []
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => r.member_email as string)
}

async function readSettings(ctx: Ctx) {
  const s = await getSettings(ctx)
  const { qpost_api_key, server_key_ok, ...rest } = s
  const own = ctx.channel.own
  return {
    ...rest,
    role: own ? 'owner' : 'member',
    channel: ctx.channel,
    channels: ctx.channels,
    // thành viên không bao giờ thấy key (kể cả dạng che)
    key_masked: own && qpost_api_key ? maskKey(qpost_api_key) : null,
    key_source: !own ? 'shared' : qpost_api_key ? 'own' : server_key_ok && env('QPOST_API_KEY') ? 'server' : 'none',
    ai_enabled: aiAllowed(ctx),
    members: own ? await listMembers(ctx) : [],
    sharing_enabled: !!adminDb(),
    dry_run: DRY(),
  }
}

/** AI viết caption dùng key Gemini của chủ app: chỉ email được phép và người được họ chia sẻ kênh */
const aiAllowed = (ctx: Ctx) => isPrivileged(ctx.email) || ctx.channels.some((c) => !c.own && isPrivileged(c.owner_email))

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Chủ kênh thêm / bỏ email thành viên
async function members(ctx: Ctx, req: Request, url: URL) {
  if (!ctx.channel.own) throw new HttpError(403, 'Chỉ chủ kênh được quản lý chia sẻ')
  if (req.method === 'POST') {
    const { email } = await readJson<{ email?: string }>(req)
    const e = String(email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(e) || e.length > 254) throw new HttpError(400, 'Email không hợp lệ')
    if (e === ctx.email) throw new HttpError(400, 'Đây là email của chính bạn')
    const { error } = await ctx.db.from('tiktok_members').insert({ owner_id: ctx.userId, member_email: e })
    if (error) {
      if (error.code === '23505') throw new HttpError(409, 'Email này đã được chia sẻ rồi')
      if (tableMissing(error)) throw new HttpError(500, 'Chưa có bảng tiktok_members — chạy lại file supabase/tiktok.sql trên Supabase')
      throw new Error(error.message)
    }
  } else if (req.method === 'DELETE') {
    const e = String(url.searchParams.get('email') ?? '').trim().toLowerCase()
    const { error } = await ctx.db.from('tiktok_members').delete().eq('owner_id', ctx.userId).eq('member_email', e)
    if (error) throw new Error(error.message)
  }
  return { members: await listMembers(ctx) }
}

async function saveSettings(ctx: Ctx, req: Request) {
  if (!ctx.channel.own) throw new HttpError(403, 'Chỉ chủ kênh được đổi cài đặt của kênh')
  const b = await readJson<Record<string, unknown>>(req)
  const privacy = String(b.privacy ?? '')
  if (!PRIVACIES.includes(privacy)) throw new HttpError(400, 'Quyền xem không hợp lệ')
  const commercial = Array.isArray(b.commercial) ? b.commercial.map(String).filter((s) => COMMERCIAL.includes(s)) : []
  if (commercial.includes('BRANDED_CONTENT') && privacy === 'SELF_ONLY') {
    throw new HttpError(400, 'Hợp tác trả phí không được để Chỉ mình tôi')
  }
  const coverMs = Number(b.cover_ms)
  if (!Number.isInteger(coverMs) || coverMs < 0 || coverMs > 600_000) throw new HttpError(400, 'Khung hình bìa phải từ 0 đến 600 giây')

  const row: Record<string, unknown> = {
    user_id: ctx.userId,
    privacy,
    allow_comment: !!b.allow_comment,
    allow_duet: !!b.allow_duet,
    allow_stitch: !!b.allow_stitch,
    auto_music: !!b.auto_music,
    photo_auto_music: !!b.photo_auto_music,
    cover_ms: coverMs,
    is_aigc: !!b.is_aigc,
    commercial,
    updated_at: nowIso(),
  }
  // key: chỉ ghi khi người dùng nhập key mới hoặc bấm xoá; bỏ trống = giữ key cũ
  const key = String(b.qpost_api_key ?? '').trim()
  if (key) {
    if (key.length < 10 || key.length > 300 || /\s/.test(key)) throw new HttpError(400, 'API key QPost không hợp lệ')
    row.qpost_api_key = key
  } else if (b.clear_key === true) {
    row.qpost_api_key = null
  }

  const { error } = await ctx.db.from('tiktok_settings').upsert(row, { onConflict: 'user_id' })
  if (error) {
    if (tableMissing(error)) throw new HttpError(500, 'Chưa có bảng tiktok_settings — chạy lại file supabase/tiktok.sql trên Supabase')
    throw new Error(error.message)
  }
  ctx.settingsCache?.delete(ctx.userId)
  return readSettings(ctx)
}

// Hỏi QPost: key có đúng không, TikTok đã kết nối chưa, kèm số liệu kênh
async function checkAccount(ctx: Ctx) {
  const key = qpostKey(await getSettings(ctx))
  const accountsUrl = `${QPOST_BASE()}/accounts`
  if (!key) return { state: 'no-key', accountsUrl }
  try {
    const j = await qpost(key, 'GET', '/api/accounts/tiktok/stats')
    return { state: 'connected', stats: j?.stats ?? null, fetchedAt: j?.fetchedAt ?? null, accountsUrl }
  } catch (e) {
    if (e instanceof QPostError) {
      if (e.status === 401) return { state: 'invalid-key', accountsUrl }
      if (e.code === 'TIKTOK_STATS_SCOPE_REQUIRED') return { state: 'connected-no-stats', accountsUrl }
      if (e.code === 'PLATFORM_CONNECTION_REQUIRED' || e.status === 404) {
        const url = (e.body as { accountsUrl?: string } | null)?.accountsUrl
        return { state: 'not-connected', accountsUrl: url || accountsUrl }
      }
    }
    return { state: 'error', message: errMsg(e), accountsUrl }
  }
}

// ---------------------------------------------------------------- hàng đợi
interface PostRow {
  id: number
  media_type: 'video' | 'images'
  media_keys: string[]
  original_name: string | null
  title: string | null
  caption: string | null
  hashtags: string | null
  cover_ms: number | null
  privacy: string | null
  scheduled_at: string
  status: 'pending' | 'posting' | 'submitted' | 'posted' | 'failed'
  qpost_post_id: string | null
  post_url: string | null
  error: string | null
  submitted_at: string | null
  posted_at: string | null
  channel_owner_id: string | null // kênh đã đăng lên (NULL ở bài cũ = kênh của chính người đăng)
  project_id?: string | null // dự án trong Forest (tính KPI video/tháng)
}

const columnMissing = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST204' || e.code === '42703' || /column .* does not exist|could not find the .* column/i.test(e.message ?? '')

// Dữ liệu báo cáo ở Dashboard: các bài (trừ bài lỗi) trong khoảng thời gian, chỉ gồm dự án / trạng thái / giờ đăng.
// Trình duyệt tự gom theo tháng (giờ địa phương) và theo dự án.
async function reportRows(ctx: Ctx, url: URL) {
  const from = new Date(String(url.searchParams.get('from')))
  const to = new Date(String(url.searchParams.get('to')))
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) throw new HttpError(400, 'Khoảng thời gian không hợp lệ')
  const { data, error } = await ctx.db.from('tiktok_posts')
    .select('project_id,status,scheduled_at')
    .eq('user_id', ctx.userId)
    .neq('status', 'failed')
    .gte('scheduled_at', from.toISOString())
    .lt('scheduled_at', to.toISOString())
    .order('scheduled_at')
    .limit(5000)
  if (error) {
    if (columnMissing(error) || tableMissing(error)) return { rows: [], needs_sql: true }
    throw new Error(error.message)
  }
  return { rows: data ?? [], needs_sql: false }
}

// Đếm bài theo dự án trong khoảng thời gian (tháng) — dùng cho KPI ở mục Project. Không tính bài lỗi.
async function projectCounts(ctx: Ctx, url: URL) {
  const from = new Date(String(url.searchParams.get('from')))
  const to = new Date(String(url.searchParams.get('to')))
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new HttpError(400, 'Khoảng thời gian không hợp lệ')
  const { data, error } = await ctx.db.from('tiktok_posts')
    .select('project_id,status')
    .eq('user_id', ctx.userId)
    .not('project_id', 'is', null)
    .neq('status', 'failed')
    .gte('scheduled_at', from.toISOString())
    .lt('scheduled_at', to.toISOString())
  if (error) {
    if (columnMissing(error) || tableMissing(error)) return { counts: {}, needs_sql: true }
    throw new Error(error.message)
  }
  const counts: Record<string, { total: number; posted: number }> = {}
  for (const r of data ?? []) {
    const c = (counts[r.project_id as string] ??= { total: 0, posted: 0 })
    c.total++
    if (r.status === 'posted') c.posted++
  }
  return { counts, needs_sql: false }
}

/** cài đặt + key của kênh mà bài này thuộc về */
const postSettings = (ctx: Ctx, p: PostRow) => settingsFor(ctx, p.channel_owner_id ?? ctx.userId)

// TikTok chỉ có MỘT ô mô tả: ghép title / caption / hashtag, cách nhau 1 dòng trống, tối đa 2200 ký tự
const buildCaption = (p: { title?: string | null; caption?: string | null; hashtags?: string | null }) =>
  [p.title, p.caption, p.hashtags].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n').slice(0, 2200)

async function updatePost(ctx: Ctx, id: number, fields: Partial<PostRow>): Promise<PostRow> {
  const { data, error } = await ctx.db.from('tiktok_posts').update(fields).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return data as PostRow
}

async function getPost(ctx: Ctx, id: number): Promise<PostRow> {
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Thiếu id bài')
  const { data, error } = await ctx.db.from('tiktok_posts').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new HttpError(404, 'Không tìm thấy bài')
  return data as PostRow
}

// Gửi một bài lên QPost kèm giờ đăng. Không ném lỗi: kết quả ghi vào bảng (failed + lý do).
async function sendPost(ctx: Ctx, post: PostRow): Promise<PostRow> {
  await updatePost(ctx, post.id, { status: 'posting', error: null, submitted_at: nowIso() })
  const scheduledFor = new Date(post.scheduled_at).getTime() - Date.now() > SOON_MS ? post.scheduled_at : undefined
  try {
    const r = await createTikTokPost({
      mediaType: post.media_type,
      keys: post.media_keys,
      caption: buildCaption(post),
      title: post.title || '',
      coverMs: post.cover_ms,
      privacy: post.privacy,
      scheduledFor,
    }, await postSettings(ctx, post))
    const qpostId = r.qpostId == null ? null : String(r.qpostId)
    if (r.status === 'FAILED') return updatePost(ctx, post.id, { status: 'failed', error: 'QPost báo FAILED ngay khi tạo', qpost_post_id: qpostId })
    if (r.url) return updatePost(ctx, post.id, { status: 'posted', post_url: r.url, qpost_post_id: qpostId, posted_at: nowIso() })
    if (qpostId) return updatePost(ctx, post.id, { status: 'submitted', qpost_post_id: qpostId, submitted_at: nowIso() })
    return updatePost(ctx, post.id, { status: 'posted', posted_at: nowIso() }) // QPost nhận nhưng không đọc được id
  } catch (e) {
    console.error(`[tiktok] #${post.id} gửi QPost lỗi:`, errMsg(e))
    return updatePost(ctx, post.id, { status: 'failed', error: errMsg(e).slice(0, 500) })
  }
}

// Hỏi QPost trạng thái các bài đã tới giờ, lấy link bài; tối đa vài bài mỗi lần để trang mở nhanh
async function syncPosts(ctx: Ctx, rows: PostRow[]) {
  const now = Date.now()
  const merge = (p: PostRow) => (fresh: PostRow) => Object.assign(p, fresh)

  const stuck = rows.filter((p) => p.status === 'posting' && p.submitted_at && now - new Date(p.submitted_at).getTime() > STUCK_MS)
  const due = rows
    .filter((p) => p.status === 'submitted' && p.qpost_post_id && new Date(p.scheduled_at).getTime() <= now + SOON_MS)
    .slice(0, 5)
  const noUrl = rows
    .filter((p) => p.status === 'posted' && !p.post_url && p.qpost_post_id && p.posted_at && now - new Date(p.posted_at).getTime() < 24 * 3600_000)
    .slice(0, 5)
  if (!stuck.length && !due.length && !noUrl.length) return
  // key theo kênh của từng bài (bỏ qua bài thuộc kênh mình không còn quyền dùng)
  const keyOf = async (p: PostRow) => qpostKey(await postSettings(ctx, p))

  await Promise.all([
    // function bị ngắt khi đang gửi: không biết QPost đã nhận chưa -> báo để người dùng kiểm tra trước khi thử lại
    ...stuck.map((p) =>
      updatePost(ctx, p.id, { status: 'failed', error: 'Bị ngắt khi đang gửi QPost — kiểm tra trên QPost trước khi thử lại' })
        .then(merge(p)).catch(() => null)),
    ...due.map(async (p) => {
      try {
        const r = await getPostResult(await keyOf(p), p.qpost_post_id!)
        if (r.status === 'POSTED') merge(p)(await updatePost(ctx, p.id, { status: 'posted', post_url: r.url, error: null, posted_at: nowIso() }))
        else if (r.status === 'FAILED') merge(p)(await updatePost(ctx, p.id, { status: 'failed', error: r.error }))
      } catch (e) {
        console.error(`[tiktok] #${p.id} không lấy được trạng thái:`, errMsg(e))
      }
    }),
    ...noUrl.map(async (p) => {
      const url = await getPublicUrl(await keyOf(p).catch(() => ''), p.qpost_post_id!)
      if (url) merge(p)(await updatePost(ctx, p.id, { post_url: url }).catch(() => p))
    }),
  ])
}

async function listPosts(ctx: Ctx) {
  const { data, error } = await ctx.db.from('tiktok_posts').select('*').order('scheduled_at', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as PostRow[]
  await syncPosts(ctx, rows)
  // ảnh trên R2 để riêng tư: tạo link xem có hạn 1 giờ cho ảnh thu nhỏ
  return Promise.all(rows.map(async (p) => ({
    ...p,
    thumbs: p.media_type === 'images' ? await Promise.all(p.media_keys.map((k) => presign(k, 'GET', 3600))) : [],
  })))
}

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ')
  }
}

const safeName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]/g, '_').slice(-80) || 'file'

// Bước 1: xin link ký sẵn để trình duyệt tải file thẳng lên R2
async function uploadUrls(ctx: Ctx, req: Request) {
  // chưa có key QPost thì bài không gửi đi được -> không cho tải file lên cho đỡ tốn chỗ
  if (!DRY() && !qpostKey(await getSettings(ctx))) {
    throw new HttpError(400, ctx.channel.own
      ? 'Chưa có API key QPost — bấm Cài đặt ở đầu trang để nhập key'
      : 'Chủ kênh chưa nhập API key QPost')
  }
  const b = await readJson<{ media_type?: string; files?: { name?: string; type?: string; size?: number }[] }>(req)
  const files = Array.isArray(b.files) ? b.files : []
  const isImages = b.media_type === 'images'
  if (!files.length) throw new HttpError(400, isImages ? 'Cần ít nhất 1 ảnh' : 'Cần file video')
  if (isImages) {
    if (files.length > MAX_IMAGES) throw new HttpError(400, `Tối đa ${MAX_IMAGES} ảnh mỗi bài`)
    if (files.some((f) => !IMAGE_TYPES.includes(String(f.type)))) throw new HttpError(400, 'Chỉ nhận ảnh JPG, PNG, WEBP')
    if (files.some((f) => Number(f.size) > MAX_IMAGE_BYTES)) throw new HttpError(400, 'Mỗi ảnh tối đa 20 MB')
  } else {
    if (files.length !== 1) throw new HttpError(400, 'Mỗi bài chỉ 1 video')
    if (!String(files[0].type).startsWith('video/') && !/\.(mp4|mov|webm)$/i.test(String(files[0].name))) {
      throw new HttpError(400, 'Chỉ nhận file video (mp4, mov, webm)')
    }
    if (Number(files[0].size) > MAX_VIDEO_BYTES) throw new HttpError(400, 'Video tối đa 500 MB')
  }
  const stamp = Date.now()
  const uploads = await Promise.all(files.map(async (f, i) => {
    const key = `${ctx.userId}/${stamp}-${i}-${safeName(String(f.name || 'file'))}`
    return { key, url: await presign(key, 'PUT', 3600) }
  }))
  return { uploads }
}

// Bước 2: ghi vào hàng đợi rồi gửi QPost ngay kèm giờ đăng
async function createPost(ctx: Ctx, req: Request) {
  const b = await readJson<Record<string, unknown>>(req)
  const mediaType = b.media_type === 'images' ? 'images' : 'video'
  const keys = Array.isArray(b.keys) ? b.keys.map(String) : []
  if (!keys.length) throw new HttpError(400, mediaType === 'images' ? 'Cần ít nhất 1 ảnh' : 'Cần file video')
  if (mediaType === 'video' && keys.length !== 1) throw new HttpError(400, 'Mỗi bài chỉ 1 video')
  if (keys.length > MAX_IMAGES) throw new HttpError(400, `Tối đa ${MAX_IMAGES} ảnh mỗi bài`)
  // chỉ được dùng file trong thư mục của chính mình trên R2
  if (keys.some((k) => !k.startsWith(`${ctx.userId}/`) || k.includes('..'))) throw new HttpError(400, 'File không hợp lệ')

  const when = new Date(String(b.scheduled_at))
  if (isNaN(when.getTime())) throw new HttpError(400, 'Giờ đăng không hợp lệ')
  const text = { title: String(b.title ?? ''), caption: String(b.caption ?? ''), hashtags: String(b.hashtags ?? '') }
  // QPost bắt buộc có caption: trống hết sẽ bị "400 Validation failed"
  if (!buildCaption(text)) throw new HttpError(400, 'Cần nhập title, caption hoặc hashtag trước khi thêm')
  const coverMs = Number(b.cover_ms)
  const privacy = PRIVACIES.includes(String(b.privacy)) ? String(b.privacy) : null
  const projectId = String(b.project_id ?? '').trim().slice(0, 64)

  const { data, error } = await ctx.db.from('tiktok_posts').insert({
    ...(projectId ? { project_id: projectId } : {}),
    user_id: ctx.userId,
    media_type: mediaType,
    media_keys: keys,
    original_name: String(b.original_name ?? '').slice(0, 200),
    description: String(b.description ?? ''),
    ...text,
    cover_ms: mediaType === 'video' && Number.isInteger(coverMs) && coverMs >= 0 ? coverMs : null,
    privacy,
    scheduled_at: when.toISOString(),
    channel_owner_id: ctx.channel.owner_id,
  }).select().single()
  if (error) {
    if (columnMissing(error)) throw new HttpError(500, 'Bảng chưa có cột dự án — chạy lại file supabase/tiktok.sql trên Supabase')
    throw new Error(error.message)
  }
  return sendPost(ctx, data as PostRow)
}

async function retry(ctx: Ctx, id: number) {
  const p = await getPost(ctx, id)
  if (p.status !== 'failed') throw new HttpError(409, 'Chỉ thử lại bài lỗi')
  if (p.qpost_post_id && !DRY()) {
    // QPost đã có bài -> dùng retry của QPost (không tạo bài trùng)
    try {
      await qpost(qpostKey(await postSettings(ctx, p)), 'POST', `/api/post/${encodeURIComponent(p.qpost_post_id)}/retry`)
    } catch (e) {
      throw new HttpError(502, errMsg(e))
    }
    return updatePost(ctx, p.id, { status: 'submitted', error: null, submitted_at: nowIso() })
  }
  return sendPost(ctx, p)
}

async function removePost(ctx: Ctx, id: number) {
  const p = await getPost(ctx, id)
  if (p.status === 'posting') throw new HttpError(409, 'Đang gửi QPost, chưa xoá được')
  const { error } = await ctx.db.from('tiktok_posts').delete().eq('id', p.id)
  if (error) throw new Error(error.message)
  await deleteObjects(p.media_keys)
}

// ---------------------------------------------------------------- mẫu nội dung
async function templates(ctx: Ctx, req: Request, id: number) {
  const t = ctx.db.from('tiktok_templates')
  if (req.method === 'GET') {
    const { data, error } = await t.select('id,name,content').order('name')
    if (error) throw new Error(error.message)
    return data
  }
  if (req.method === 'DELETE') {
    const { data, error } = await t.delete().eq('id', id).select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new HttpError(404, 'Không tìm thấy mẫu')
    return null
  }
  const b = await readJson<{ name?: string; content?: string }>(req)
  const name = String(b.name ?? '').trim()
  const content = String(b.content ?? '').trim()
  if (!name || !content) throw new HttpError(400, 'Cần tên mẫu và nội dung')
  if (name.length > 100) throw new HttpError(400, 'Tên mẫu tối đa 100 ký tự')
  // trùng tên thì ghi đè nội dung (cập nhật mẫu)
  const { data, error } = await t
    .upsert({ user_id: ctx.userId, name, content, updated_at: nowIso() }, { onConflict: 'user_id,name' })
    .select('id,name,content').single()
  if (error) throw new Error(error.message)
  return data
}

// ---------------------------------------------------------------- AI viết title/caption/hashtag
const schema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Tiêu đề ngắn, cuốn hút (<= 80 ký tự)' },
    caption: { type: 'string', description: 'Caption TikTok 1-3 câu, có hook ở đầu' },
    hashtags: {
      type: 'array',
      items: { type: 'string', description: 'Đúng MỘT hashtag, vd #phobo' },
      description: `Đúng ${HASHTAG_COUNT} hashtag, mỗi phần tử là một hashtag riêng`,
    },
  },
  required: ['title', 'caption', 'hashtags'],
  additionalProperties: false,
}

const SYSTEM =
  'Bạn là chuyên gia viết nội dung TikTok. Viết title, caption và hashtag giúp video lên xu hướng. ' +
  'Không bịa thông tin không có trong mô tả. Hashtag phù hợp thị trường người xem. ' +
  `hashtags là mảng ĐÚNG ${HASHTAG_COUNT} phần tử: ${HASHTAG_COUNT} từ khoá quan trọng nhất của video, mỗi phần tử một hashtag ` +
  'viết liền không dấu, chữ thường, vd ["#phobo", "#amthuchanoi", "#reviewdoan", "#hanoi", "#foodtiktok"]. ' +
  `Nếu nội dung video đã có sẵn hashtag thì ưu tiên chọn ${HASHTAG_COUNT} cái phù hợp nhất trong đó. ` +
  'Chỉ trả về JSON gồm title, caption, hashtags.'

const userPrompt = (description: string) =>
  `Ngôn ngữ: Tiếng Việt\nGiọng văn: tự nhiên, gần gũi\n\nNội dung video:\n${description}`

interface Meta { title: string; caption: string; hashtags: string[] }

let gemini: GoogleGenAI | null = null
async function viaGemini(description: string): Promise<Meta> {
  if (!env('GEMINI_API_KEY')) throw new Error('Server chưa cấu hình GEMINI_API_KEY')
  gemini ??= new GoogleGenAI({ apiKey: env('GEMINI_API_KEY') })
  // Gemini hay báo 503 (quá tải) tạm thời -> thử lại tối đa 3 lần
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await gemini.models.generateContent({
        model: env('GEMINI_MODEL') || 'gemini-3.8-flash',
        contents: userPrompt(description),
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          abortSignal: AbortSignal.timeout(40_000),
        },
      })
      if (!response.text) throw new Error('Gemini không trả về nội dung (có thể bị chặn bởi bộ lọc an toàn)')
      return JSON.parse(response.text) as Meta
    } catch (e) {
      const err = e as { name?: string; status?: number; message?: string }
      const msg = String(err.message ?? '')
      if (/RESOURCE_EXHAUSTED|quota/i.test(msg) && /per ?day|PerDay/i.test(msg)) {
        throw new HttpError(429, 'Gemini đã hết lượt miễn phí trong ngày, thử lại sau hoặc nâng gói')
      }
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError'
      const busy = timedOut || [429, 500, 503].includes(Number(err.status)) || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(msg)
      if (timedOut && attempt >= 3) throw new Error('Gemini không trả lời (quá 40 giây x 3 lần), thử lại sau')
      if (!busy || attempt >= 3) throw e
      await new Promise((r) => setTimeout(r, attempt * 4000))
    }
  }
}

let claude: Anthropic | null = null
async function viaClaude(description: string): Promise<Meta> {
  if (!env('ANTHROPIC_API_KEY')) throw new Error('Server chưa cấu hình ANTHROPIC_API_KEY')
  claude ??= new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = await claude.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    // bị từ chối vì chính sách thì API tự chạy lại trên model dự phòng
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(description) }],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  if (response.stop_reason === 'refusal') throw new Error('Claude từ chối tạo nội dung cho video này')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = response.content?.find((b: any) => b.type === 'text')?.text
  if (!text) throw new Error('Claude không trả về nội dung')
  return JSON.parse(text) as Meta
}

async function generate(ctx: Ctx, req: Request): Promise<Meta> {
  if (!aiAllowed(ctx)) throw new HttpError(403, 'AI viết caption chưa bật cho tài khoản này — bạn vẫn tự nhập title, caption, hashtag được')
  const { description } = await readJson<{ description?: string }>(req)
  if (!description?.trim()) throw new HttpError(400, 'Cần mô tả nội dung video')
  const data = env('AI_PROVIDER').toLowerCase() === 'claude' ? await viaClaude(description) : await viaGemini(description)
  if (!data?.title || !data?.caption || !Array.isArray(data?.hashtags)) throw new Error('AI trả về sai định dạng')
  // mỗi phần tử chỉ lấy hashtag đầu tiên, bỏ trùng, bỏ hashtag dài bất thường (AI đôi khi dính chuỗi rác)
  const tags = data.hashtags
    .map((h) => (String(h).match(/[\p{L}\p{N}_]{2,}/u) || [''])[0].toLowerCase())
    .filter((t) => t && t.length <= 30)
  data.hashtags = [...new Set(tags)].slice(0, HASHTAG_COUNT).map((t) => `#${t}`)
  return data
}

// ---------------------------------------------------------------- định tuyến
async function handle(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') ?? ''
    const id = Number(url.searchParams.get('id'))
    const ctx = await auth(req)
    const route = `${req.method} ${action}`

    if (route === 'GET posts') return json(await listPosts(ctx))
    if (route === 'POST posts') return json(await createPost(ctx, req), 201)
    if (route === 'DELETE posts') { await removePost(ctx, id); return new Response(null, { status: 204 }) }
    if (route === 'POST upload-url') return json(await uploadUrls(ctx, req))
    if (route === 'POST retry') return json(await retry(ctx, id))
    if (route === 'POST generate') return json(await generate(ctx, req))
    if (route === 'GET settings') return json(await readSettings(ctx))
    if (route === 'POST settings') return json(await saveSettings(ctx, req))
    if (route === 'GET account') return json(await checkAccount(ctx))
    if (route === 'GET project-counts') return json(await projectCounts(ctx, url))
    if (route === 'GET report') return json(await reportRows(ctx, url))
    if (action === 'members' && ['GET', 'POST', 'DELETE'].includes(req.method)) return json(await members(ctx, req, url))
    if (action === 'templates' && ['GET', 'POST', 'DELETE'].includes(req.method)) {
      const r = await templates(ctx, req, id)
      return r === null ? new Response(null, { status: 204 }) : json(r, req.method === 'POST' ? 201 : 200)
    }
    return json({ error: 'Không có API này' }, 404)
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('[tiktok]', e)
    return json({ error: errMsg(e) }, 500)
  }
}

export const GET = handle
export const POST = handle
export const DELETE = handle
