import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { BookOpen, CheckCircle2, ExternalLink, KeyRound, Loader2, PlugZap, Save, SlidersHorizontal, UserPlus, Users, X } from 'lucide-react'
import { api, PRIVACY_OPTIONS, setActiveChannel, type TikTokSettings } from '../lib/tiktokApi'
import { useToasts } from './ui'

// Mục "Cài đặt" trong trang Đăng TikTok: key QPost riêng, kiểm tra kết nối TikTok, tuỳ chọn mặc định khi đăng.
// Việc đăng nhập / kết nối tài khoản TikTok vẫn làm trên QPost (QPost không có API cho bước này).

interface Account {
  state: 'connected' | 'connected-no-stats' | 'not-connected' | 'invalid-key' | 'no-key' | 'error'
  stats?: { followers?: number; following?: number; likes?: number; videos?: number } | null
  fetchedAt?: string | null
  accountsUrl: string
  message?: string
}

const QPOST_HOME = 'https://qpost.dev'
const num = (n?: number) => (typeof n === 'number' ? n.toLocaleString('vi-VN') : '—')

function Check({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 14 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--wine)' }} />
      <span>
        {children}
        {hint && <span className="small muted" style={{ display: 'block' }}>{hint}</span>}
      </span>
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontWeight: 800, fontSize: 18 }}>{value}</div>
      <div className="small muted">{label}</div>
    </div>
  )
}

export function TikTokSettingsPanel({ initial, onSaved, onClose, onChannelChange }: {
  initial: TikTokSettings | null
  onSaved: (s: TikTokSettings) => void
  onClose: () => void
  onChannelChange: () => void // đổi kênh -> trang tải lại cài đặt + hàng đợi
}) {
  const [f, setF] = useState<TikTokSettings | null>(initial)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [acc, setAcc] = useState<Account | null>(null)
  const [checking, setChecking] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  // chưa có key: 'ask' = hỏi đã có key chưa, 'have' = hiện ô nhập, 'guide' = hướng dẫn tạo key
  const [keyMode, setKeyMode] = useState<'ask' | 'have' | 'guide'>('ask')
  const [memberBusy, setMemberBusy] = useState(false)

  useEffect(() => { if (initial) setF(initial) }, [initial])

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setAcc(await api<Account>('account'))
    } catch (e) {
      setAcc({ state: 'error', message: e instanceof Error ? e.message : String(e), accountsUrl: `${QPOST_HOME}/accounts` })
    }
    setChecking(false)
  }, [])
  // kiểm tra lại khi đổi kênh
  const channelId = f?.channel.owner_id
  useEffect(() => { if (channelId) void check() }, [check, channelId])

  if (!f) return <div className="glass panel" style={{ marginBottom: 16 }}>Đang tải cài đặt…</div>
  const own = f.role === 'owner'

  const changeMembers = async (method: 'POST' | 'DELETE', email: string) => {
    setMemberBusy(true)
    try {
      const r = await api<{ members: string[] }>(
        'members',
        method === 'POST' ? { method, body: JSON.stringify({ email }) } : { method },
        method === 'DELETE' ? `&email=${encodeURIComponent(email)}` : '',
      )
      setF({ ...f, members: r.members })
      onSaved({ ...f, members: r.members })
      if (method === 'POST') setNewEmail('')
      useToasts.getState().push(method === 'POST' ? `Đã chia sẻ kênh cho ${email}` : `Đã bỏ chia sẻ với ${email}`, 'success')
    } catch (e) {
      useToasts.getState().push((e instanceof Error ? e.message : String(e)), 'error')
    }
    setMemberBusy(false)
  }

  const set = <K extends keyof TikTokSettings>(k: K, v: TikTokSettings[K]) => setF({ ...f, [k]: v })
  const toggleCommercial = (c: 'YOUR_BRAND' | 'BRANDED_CONTENT', on: boolean) =>
    set('commercial', on ? [...new Set([...f.commercial, c])] : f.commercial.filter((x) => x !== c))
  const brandedPrivate = f.commercial.includes('BRANDED_CONTENT') && f.privacy === 'SELF_ONLY'

  const save = async (extra: { clear_key?: boolean } = {}) => {
    setSaving(true)
    try {
      const { privacy, allow_comment, allow_duet, allow_stitch, auto_music, photo_auto_music, cover_ms, is_aigc, commercial } = f
      const r = await api<TikTokSettings>('settings', {
        method: 'POST',
        body: JSON.stringify({
          privacy, allow_comment, allow_duet, allow_stitch, auto_music, photo_auto_music, cover_ms, is_aigc, commercial,
          qpost_api_key: key.trim(),
          ...extra,
        }),
      })
      const keyChanged = !!key.trim() || !!extra.clear_key
      setF(r)
      onSaved(r)
      setKey('')
      setConfirmClear(false)
      useToasts.getState().push(extra.clear_key ? 'Đã xoá key QPost riêng' : 'Đã lưu cài đặt đăng TikTok', 'success')
      if (keyChanged) void check() // key mới -> kiểm tra lại kết nối
    } catch (e) {
      useToasts.getState().push('Không lưu được cài đặt: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
    setSaving(false)
  }

  const keyText = {
    own: <>Đang dùng <b>key riêng</b> của bạn: <code>{f.key_masked}</code></>,
    server: <>Đang dùng <b>key chung trên server</b>. Nhập key riêng để đăng lên tài khoản TikTok bạn đã kết nối trong QPost.</>,
    none: <span style={{ color: 'var(--wine)' }}>Chưa có API key QPost — nhập key để đăng được bài.</span>,
    shared: null,
  }[f.key_source]

  return (
    <div className="glass panel" style={{ marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 className="grow" style={{ margin: 0 }}><SlidersHorizontal size={18} /> Cài đặt đăng TikTok</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Đóng cài đặt"><X size={18} /></button>
      </div>
      {f.dry_run && (
        <div className="tag" style={{ display: 'block', whiteSpace: 'normal', marginBottom: 10 }}>
          ⚠️ Server đang ở chế độ thử (QPOST_DRY_RUN): bài không được gửi thật lên QPost.
        </div>
      )}

      {/* ---------- kênh đang dùng ---------- */}
      {f.channels.length > 1 && (
        <label className="field" style={{ maxWidth: 420, marginBottom: 10 }}>Kênh đang đăng lên
          <select
            className="select"
            value={f.channel.owner_id}
            onChange={(e) => { setActiveChannel(e.target.value); onChannelChange() }}
          >
            {f.channels.map((c) => (
              <option key={c.owner_id} value={c.owner_id}>{c.own ? 'Kênh của tôi' : `Kênh của ${c.owner_email} (được chia sẻ)`}</option>
            ))}
          </select>
        </label>
      )}
      {!own && (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Users size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div className="small">
            Bạn đang đăng lên kênh của <b>{f.channel.owner_email}</b> (được chia sẻ). Bài sẽ lên tài khoản TikTok của chủ kênh.
            Chỉ chủ kênh đổi được API key và tuỳ chọn mặc định.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
        {/* ---------- kết nối QPost ---------- */}
        <section className="list" style={{ gap: 10 }}>
          <h4 style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><KeyRound size={16} /> Kết nối QPost</h4>
          {/* chưa có key: hỏi đã có key chưa */}
          {own && f.key_source === 'none' && keyMode === 'ask' && (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Bạn đã có API key QPost chưa?</div>
              <p className="small muted" style={{ margin: '0 0 10px' }}>
                Forest đăng bài lên TikTok qua QPost. Mỗi tài khoản dùng key QPost của mình để đăng lên kênh TikTok của mình.
              </p>
              <div className="row" style={{ marginTop: 0, flexWrap: 'wrap' }}>
                <button className="btn dark" onClick={() => setKeyMode('have')}><KeyRound size={15} /> Đã có, nhập key</button>
                <button className="btn" onClick={() => setKeyMode('guide')}><BookOpen size={15} /> Chưa có, hướng dẫn tạo</button>
              </div>
            </div>
          )}

          {/* hướng dẫn tạo key */}
          {own && keyMode === 'guide' && (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Tạo API key QPost (khoảng 5 phút)</div>
              <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.5 }}>
                <li>
                  Mở <a href={`${QPOST_HOME}/login`} target="_blank" rel="noopener noreferrer">qpost.dev <ExternalLink size={11} /></a> và
                  đăng nhập (chưa có tài khoản thì tạo mới).
                </li>
                <li>
                  Vào trang <a href={`${QPOST_HOME}/accounts`} target="_blank" rel="noopener noreferrer">Accounts <ExternalLink size={11} /></a>,
                  chọn <b>TikTok</b>, đăng nhập tài khoản TikTok muốn đăng bài và bấm cho phép.
                </li>
                <li>
                  Mở trang <a href={`${QPOST_HOME}/docs/`} target="_blank" rel="noopener noreferrer">Docs <ExternalLink size={11} /></a>,
                  tìm nút <b>Generate an API key</b> để tạo key mới, rồi bấm copy.
                  Key chỉ hiện một lần, nên dán ngay vào đây.
                </li>
                <li>Quay lại đây, bấm <b>Tôi đã có key</b>, dán key, bấm <b>Lưu key</b> rồi <b>Kiểm tra kết nối</b>.</li>
              </ol>
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn dark" onClick={() => setKeyMode('have')}><KeyRound size={15} /> Tôi đã có key</button>
                {f.key_source === 'none' && <button className="btn ghost" onClick={() => setKeyMode('ask')}>Quay lại</button>}
              </div>
            </div>
          )}

          {own && (f.key_source !== 'none' || keyMode === 'have') && <>
          <p className="small" style={{ margin: 0 }}>{keyText}</p>
          <label className="field">API key QPost
            <input
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={f.key_source === 'own' ? 'Dán key mới để thay key hiện tại' : 'Dán API key QPost'}
            />
          </label>
          <div className="row" style={{ marginTop: 0, flexWrap: 'wrap' }}>
            <button className="btn dark" disabled={saving || !key.trim()} onClick={() => void save()}>
              <Save size={15} /> Lưu key
            </button>
            {f.key_source === 'own' && (
              <button className="btn ghost danger" disabled={saving} onClick={() => (confirmClear ? void save({ clear_key: true }) : setConfirmClear(true))}>
                {confirmClear ? 'Bấm lần nữa để xoá' : 'Xoá key riêng'}
              </button>
            )}
            {keyMode !== 'guide' && (
              <button className="btn ghost" type="button" onClick={() => setKeyMode('guide')}><BookOpen size={14} /> Cách tạo key</button>
            )}
          </div>
          </>}

          <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ marginTop: 0, marginBottom: 8 }}>
              <b className="grow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><PlugZap size={16} /> Tài khoản TikTok</b>
              <button className="btn ghost" disabled={checking} onClick={() => void check()}>
                {checking ? <Loader2 size={15} className="spin" /> : null} Kiểm tra kết nối
              </button>
            </div>
            {!acc && checking && <div className="small muted">Đang hỏi QPost…</div>}
            {acc?.state === 'connected' && (
              <>
                <div className="small" style={{ color: '#1e7a45', fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <CheckCircle2 size={15} /> Đã kết nối TikTok qua QPost
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  <Stat label="Follower" value={num(acc.stats?.followers)} />
                  <Stat label="Đang follow" value={num(acc.stats?.following)} />
                  <Stat label="Lượt thích" value={num(acc.stats?.likes)} />
                  <Stat label="Video" value={num(acc.stats?.videos)} />
                </div>
                {acc.fetchedAt && <div className="small muted" style={{ marginTop: 6 }}>Cập nhật {new Date(acc.fetchedAt).toLocaleString('vi-VN')}</div>}
              </>
            )}
            {acc?.state === 'connected-no-stats' && (
              <div className="small">✅ Đã kết nối TikTok. QPost chưa có quyền xem số liệu kênh — cấp lại quyền trong trang Accounts của QPost nếu muốn xem.</div>
            )}
            {acc && ['not-connected', 'invalid-key', 'no-key', 'error'].includes(acc.state) && (
              <div className="small" style={{ color: 'var(--wine)' }}>
                {acc.state === 'not-connected' && 'Chưa kết nối TikTok trong QPost. Mở trang Accounts của QPost, đăng nhập TikTok rồi bấm Kiểm tra lại.'}
                {acc.state === 'invalid-key' && 'API key không đúng hoặc đã bị xoá trên QPost.'}
                {acc.state === 'no-key' && 'Chưa có API key QPost.'}
                {acc.state === 'error' && `Không kiểm tra được: ${acc.message}`}
              </div>
            )}
            {acc && acc.state !== 'connected' && acc.state !== 'connected-no-stats' && (
              <a className="btn" style={{ marginTop: 8 }} href={acc.accountsUrl} target="_blank" rel="noopener noreferrer">
                Mở QPost Accounts <ExternalLink size={14} />
              </a>
            )}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Đăng nhập / đổi tài khoản TikTok vẫn làm trên QPost (trang Accounts), QPost không cho làm việc này qua API.
          </p>
        </section>

        {/* ---------- mặc định khi đăng (thành viên chỉ xem) ---------- */}
        <fieldset disabled={!own} className="list" style={{ gap: 10, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <h4 style={{ margin: 0 }}>Mặc định khi đăng {!own && <span className="small muted">(chủ kênh cài đặt)</span>}</h4>
          <div className="field">Ai được xem
            <div className="seg" role="radiogroup" aria-label="Quyền xem mặc định" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
              {PRIVACY_OPTIONS.map((o) => (
                <button key={o.value} role="radio" aria-checked={f.privacy === o.value} className={f.privacy === o.value ? 'on' : ''} onClick={() => set('privacy', o.value)}>{o.label}</button>
              ))}
            </div>
          </div>
          <Check checked={f.allow_comment} onChange={(v) => set('allow_comment', v)}>Cho phép bình luận</Check>
          <Check checked={f.allow_duet} onChange={(v) => set('allow_duet', v)}>Cho phép Duet</Check>
          <Check checked={f.allow_stitch} onChange={(v) => set('allow_stitch', v)}>Cho phép Stitch</Check>
          <Check checked={f.auto_music} onChange={(v) => set('auto_music', v)} hint="Tắt = giữ nguyên tiếng gốc của video">Tự thêm nhạc cho video</Check>
          <Check checked={f.photo_auto_music} onChange={(v) => set('photo_auto_music', v)} hint="TikTok tự chọn nhạc nền cho bài ảnh">Tự thêm nhạc cho bài ảnh</Check>
          <Check checked={f.is_aigc} onChange={(v) => set('is_aigc', v)} hint="TikTok gắn nhãn “Nội dung do AI tạo”">Gắn nhãn nội dung AI</Check>
          <label className="field">Khung hình bìa mặc định (giây)
            <input
              className="input"
              type="number"
              min={0}
              max={600}
              step={0.1}
              value={f.cover_ms / 1000}
              onChange={(e) => set('cover_ms', Math.max(0, Math.min(600_000, Math.round(Number(e.target.value) * 1000) || 0)))}
              style={{ maxWidth: 140 }}
            />
            <span className="small muted">Dùng khi chưa chọn bìa cho video. Vẫn chỉnh được từng video ở form đăng.</span>
          </label>
          <div className="field">Nội dung quảng cáo
            <Check checked={f.commercial.includes('YOUR_BRAND')} onChange={(v) => toggleCommercial('YOUR_BRAND', v)} hint="Quảng bá sản phẩm/thương hiệu của chính bạn">Thương hiệu của bạn</Check>
            <Check checked={f.commercial.includes('BRANDED_CONTENT')} onChange={(v) => toggleCommercial('BRANDED_CONTENT', v)} hint="Có hợp tác trả phí với nhãn hàng">Hợp tác trả phí</Check>
          </div>
          {brandedPrivate && (
            <div className="small" style={{ color: 'var(--wine)' }}>Hợp tác trả phí không được để “Chỉ mình tôi” — đổi quyền xem trước khi lưu.</div>
          )}
          {own && (
            <div className="row" style={{ marginTop: 4 }}>
              <button className="btn dark" disabled={saving || brandedPrivate} onClick={() => void save()}>
                {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Lưu cài đặt
              </button>
            </div>
          )}
        </fieldset>
      </div>

      {/* ---------- chia sẻ kênh (chủ kênh) ---------- */}
      {own && (
        <section className="list" style={{ gap: 10, marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
          <h4 style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><Users size={16} /> Chia sẻ kênh</h4>
          <p className="small muted" style={{ margin: 0 }}>
            Thêm email Google của người cùng làm. Họ đăng nhập Forest bằng email đó là đăng được lên kênh TikTok này,
            dùng được AI viết caption, nhưng <b>không thấy API key</b> và không đổi được cài đặt. Mỗi người chỉ thấy bài của chính mình trong hàng đợi.
          </p>
          {!f.sharing_enabled && (
            <div className="small" style={{ color: 'var(--wine)' }}>
              ⚠️ Server chưa có SUPABASE_SERVICE_ROLE_KEY nên người được chia sẻ chưa dùng được kênh. Vẫn thêm email trước được.
            </div>
          )}
          <form
            className="row"
            style={{ marginTop: 0, flexWrap: 'wrap' }}
            onSubmit={(e) => { e.preventDefault(); if (newEmail.trim()) void changeMembers('POST', newEmail.trim()) }}
          >
            <input
              className="input grow"
              type="email"
              placeholder="email@gmail.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={{ minWidth: 200 }}
              aria-label="Email người được chia sẻ"
            />
            <button className="btn dark" type="submit" disabled={memberBusy || !newEmail.trim()}><UserPlus size={15} /> Thêm</button>
          </form>
          {f.members.length === 0 ? (
            <div className="small muted">Chưa chia sẻ cho ai.</div>
          ) : (
            <div className="list" style={{ gap: 6 }}>
              {f.members.map((m) => (
                <div key={m} className="card row" style={{ padding: '6px 10px', marginTop: 0 }}>
                  <span className="grow small" style={{ overflowWrap: 'anywhere' }}>{m}</span>
                  <button className="icon-btn" disabled={memberBusy} onClick={() => void changeMembers('DELETE', m)} aria-label={`Bỏ chia sẻ với ${m}`}><X size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
