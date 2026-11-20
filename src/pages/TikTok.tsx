import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from 'react'
import { ChevronLeft, ChevronRight, Play, RefreshCw, Save, Send, Settings2, Sparkles, Trash2, Undo2, Upload, X } from 'lucide-react'
import { cx } from '../lib/utils'
import { useToasts } from '../components/ui'
import { useStore } from '../store'
import { api, putFile, PRIVACY_OPTIONS, type Privacy, type TikTokSettings } from '../lib/tiktokApi'
import { TikTokSettingsPanel } from '../components/TikTokSettingsPanel'

// Trang "Đăng TikTok": giao diện cho api/tiktok.ts (Vercel Function; khi dev, Vite chạy thẳng file đó).
// File tải thẳng lên Cloudflare R2, hàng đợi lưu ở Supabase, QPost tự đăng đúng giờ.

type MediaType = 'video' | 'images'
interface Post {
  id: number
  media_type: MediaType
  original_name: string
  title: string
  caption: string
  hashtags: string
  scheduled_at: string
  status: 'pending' | 'posting' | 'submitted' | 'posted' | 'failed'
  error: string | null
  post_url: string | null
  thumbs: string[] // link xem ảnh trên R2 (có hạn 1 giờ)
  cover_ms: number | null
  privacy: Privacy | null
  project_id?: string | null
}
interface Tpl { id: number; name: string; content: string }
interface Img { id: number; file: File; url: string }

const MAX_IMAGES = 35
const TITLE_MAX = 2200
const STATUS_LABEL: Record<Post['status'], string> = {
  pending: 'chờ đăng', posting: 'đang gửi', submitted: 'đã gửi', posted: 'đã đăng', failed: 'lỗi',
}

const fmtTime = (ms: number) => {
  const s = ms / 1000
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}
const defaultWhen = () => {
  const d = new Date(Date.now() + 10 * 60000)
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
// Hộp xác nhận thay cho confirm() của trình duyệt (đồng bộ giao diện Forest)
interface Confirm { title: string; body: string; okLabel: string; danger?: boolean; onOk: () => void }

function ConfirmDialog({ c, onCancel, onOk }: { c: Confirm; onCancel: () => void; onOk: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onCancel])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" style={{ width: 'min(400px, 100%)' }}>
        <h3 id="confirm-title">{c.title}</h3>
        <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>{c.body}</p>
        <div className="modal-actions">
          <button ref={cancelRef} className="btn ghost" onClick={onCancel}>Huỷ</button>
          <button
            className="btn"
            onClick={onOk}
            style={c.danger ? { background: '#b3261e', color: '#fff', borderColor: '#b3261e' } : undefined}
          >
            {c.okLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// Vùng kéo thả file (video hoặc ảnh). Bấm vào cũng mở hộp chọn file.
const zoneStyle = (over: boolean, compact: boolean): CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: compact ? '14px 16px' : '34px 16px', borderRadius: 16, cursor: 'pointer', textAlign: 'center',
  border: `2px dashed ${over ? 'var(--wine)' : 'rgba(20,20,20,.18)'}`,
  background: over ? 'var(--wine-soft)' : 'rgba(255,255,255,.4)',
  transform: over ? 'scale(1.01)' : 'none', transition: 'all .15s ease',
})

export default function TikTok() {
  const [type, setType] = useState<MediaType>('video')
  const [video, setVideo] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [coverMs, setCoverMs] = useState<number | null>(null)
  const [coverMax, setCoverMax] = useState(0)
  const [coverErr, setCoverErr] = useState(false)

  const [images, setImages] = useState<Img[]>([])
  const imagesRef = useRef<Img[]>([])
  imagesRef.current = images
  const nextImgId = useRef(0)
  const dragFrom = useRef<number | null>(null)

  const [desc, setDesc] = useState('')
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [tags, setTags] = useState('')
  const [when, setWhen] = useState(defaultWhen)
  const [privacy, setPrivacy] = useState<Privacy>('PUBLIC_TO_EVERYONE')
  // dự án của bài (tính KPI video/tháng ở mục Project)
  const projects = useStore((s) => s.projects)
  const [projectId, setProjectId] = useState('')
  const projectName = (id?: string | null) => (id ? projects.find((p) => p.id === id)?.title ?? 'Dự án đã xoá' : null)
  // cài đặt đăng TikTok của tài khoản (key QPost, tuỳ chọn mặc định)
  const [cfg, setCfg] = useState<TikTokSettings | null>(null)
  const [showCfg, setShowCfg] = useState(false)
  const applyCfg = useCallback((s: TikTokSettings) => {
    setCfg(s)
    setPrivacy(s.privacy) // quyền xem mặc định cho bài mới
    if (s.key_source === 'none') setShowCfg(true) // chưa có key QPost nào -> mở sẵn cài đặt
  }, [])
  useEffect(() => {
    api<TikTokSettings>('settings').then(applyCfg).catch(() => { /* lỗi quyền đã hiện ở listErr */ })
  }, [applyCfg])
  const [genMsg, setGenMsg] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDlg, setConfirmDlg] = useState<Confirm | null>(null)
  const closeConfirm = useCallback(() => setConfirmDlg(null), [])
  const askConfirm = (c: Confirm) => setConfirmDlg(c)

  const [templates, setTemplates] = useState<Tpl[]>([])
  const [tplId, setTplId] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [listErr, setListErr] = useState('')
  const [lb, setLb] = useState<{ items: { src: string; name?: string }[]; i: number } | null>(null)

  // ---------- video + ảnh bìa ----------
  useEffect(() => {
    setCoverMs(null)
    setCoverErr(false)
    if (!video) return setVideoUrl(null)
    const u = URL.createObjectURL(video)
    setVideoUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [video])

  // ảnh được giải phóng khi rời trang
  useEffect(() => () => imagesRef.current.forEach((it) => URL.revokeObjectURL(it.url)), [])

  const setCover = (ms: number) => {
    const v = Math.max(0, Math.min(coverMax, Math.round(ms / 100) * 100))
    setCoverMs(v)
    if (videoRef.current) videoRef.current.currentTime = v / 1000
  }

  // kéo thả: nhận cả FileList (chọn file) lẫn mảng File (kéo thả)
  const dropProps = (onFiles: (files: FileList | File[]) => void) => ({
    onDragEnter: (e: ReactDragEvent<HTMLLabelElement>) => { e.preventDefault(); setDragOver(true) },
    onDragOver: (e: ReactDragEvent<HTMLLabelElement>) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
    onDragLeave: (e: ReactDragEvent<HTMLLabelElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
    },
    onDrop: (e: ReactDragEvent<HTMLLabelElement>) => {
      e.preventDefault()
      setDragOver(false)
      onFiles(e.dataTransfer.files)
    },
  })

  const pickVideo = (files: FileList | File[]) => {
    const f = [...files].find((x) => x.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(x.name))
    if (!f) return setMsg('Chỉ nhận file video (mp4, mov, webm…)')
    setMsg('')
    setVideo(f)
  }

  const askRemoveVideo = () => {
    if (!video) return
    askConfirm({
      title: 'Bỏ video này?',
      body: `"${video.name}" sẽ bị bỏ khỏi form. File gốc trên máy bạn không bị xoá.`,
      okLabel: 'Bỏ video',
      danger: true,
      onOk: () => setVideo(null),
    })
  }

  const onPickImages = (files: FileList | File[] | null) => {
    if (!files) return
    const picked = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type))
    const room = MAX_IMAGES - images.length
    if (picked.length > room) setMsg(`Chỉ thêm được ${Math.max(0, room)} ảnh nữa (tối đa ${MAX_IMAGES}).`)
    const add = picked.slice(0, Math.max(0, room)).map((file) => ({ id: ++nextImgId.current, file, url: URL.createObjectURL(file) }))
    setImages((cur) => [...cur, ...add])
  }
  const moveImage = (from: number, to: number) => {
    setImages((cur) => {
      if (to < 0 || to >= cur.length || from === to) return cur
      const next = [...cur]
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it)
      return next
    })
  }
  const removeImage = (i: number) => {
    setImages((cur) => {
      URL.revokeObjectURL(cur[i].url)
      return cur.filter((_, k) => k !== i)
    })
  }
  const clearImages = () => {
    images.forEach((it) => URL.revokeObjectURL(it.url))
    setImages([])
  }

  // ---------- AI, mẫu nội dung ----------
  const loadTemplates = useCallback(async () => {
    try {
      setTemplates(await api<Tpl[]>('templates'))
    } catch (e) {
      setGenMsg(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const generate = async () => {
    if (!desc.trim()) return setGenMsg('Nhập mô tả trước')
    setGenMsg('Đang viết…')
    try {
      const j = await api<{ title: string; caption: string; hashtags: string[] }>('generate', {
        method: 'POST',
        body: JSON.stringify({ description: desc.trim() }),
      })
      setTitle(j.title)
      setCaption(j.caption)
      setTags(j.hashtags.join(' '))
      setGenMsg('Xong — có thể sửa lại')
    } catch (e) {
      setGenMsg('Lỗi: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const pickTemplate = (id: string) => {
    setTplId(id)
    const t = templates.find((x) => String(x.id) === id)
    if (!t) return
    const cur = desc.trim()
    if (cur && cur !== t.content && !confirm(`Thay nội dung đang nhập bằng mẫu "${t.name}"?`)) return setTplId('')
    setDesc(t.content)
  }

  const saveTemplate = async () => {
    const content = desc.trim()
    if (!content) return setGenMsg('Nhập nội dung trước khi lưu mẫu')
    const current = templates.find((x) => String(x.id) === tplId)
    const name = prompt('Tên mẫu (trùng tên sẽ ghi đè mẫu cũ):', current ? current.name : '')?.trim()
    if (!name) return
    if (templates.some((t) => t.name === name) && name !== current?.name && !confirm(`Đã có mẫu "${name}". Ghi đè?`)) return
    try {
      const j = await api<Tpl>('templates', { method: 'POST', body: JSON.stringify({ name, content }) })
      setGenMsg(`Đã lưu mẫu "${j.name}"`)
      await loadTemplates()
      setTplId(String(j.id))
    } catch (e) {
      setGenMsg('Lỗi: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const deleteTemplate = async () => {
    const t = templates.find((x) => String(x.id) === tplId)
    if (!t || !confirm(`Xoá mẫu "${t.name}"?`)) return
    try {
      await api('templates', { method: 'DELETE' }, `&id=${t.id}`)
      setTplId('')
      setGenMsg('Đã xoá mẫu')
      await loadTemplates()
    } catch (e) {
      setGenMsg('Lỗi: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // ---------- hàng đợi ----------
  const load = useCallback(async () => {
    try {
      setPosts(await api<Post[]>('posts'))
      setListErr('')
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void loadTemplates()
    void load()
    const t = setInterval(() => void load(), 30000)
    return () => clearInterval(t)
  }, [load, loadTemplates])

  const submit = async () => {
    if (![title, caption, tags].some((s) => s.trim())) {
      setMsg('Nhập title, caption hoặc hashtag trước (QPost bắt buộc có nội dung)')
      return
    }
    if (type === 'video' && !video) return setMsg('Chọn file video trước')
    if (type === 'images' && !images.length) return setMsg('Chọn ít nhất 1 ảnh')
    const files = type === 'video' ? [video!] : images.map((it) => it.file)

    setBusy(true)
    try {
      // 1) xin link ký sẵn, 2) tải file thẳng lên R2, 3) ghi hàng đợi + gửi QPost
      setMsg('Đang chuẩn bị tải lên…')
      const { uploads } = await api<{ uploads: { key: string; url: string }[] }>('upload-url', {
        method: 'POST',
        body: JSON.stringify({ media_type: type, files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })) }),
      })
      const total = files.reduce((s, f) => s + f.size, 0) || 1
      const loaded = files.map(() => 0)
      await Promise.all(uploads.map((u, i) => putFile(u.url, files[i], (n) => {
        loaded[i] = n
        setMsg(`Đang tải lên ${Math.min(100, Math.round((loaded.reduce((a, b) => a + b, 0) / total) * 100))}%`)
      })))

      setMsg('Đang gửi QPost…')
      const j = await api<Post>('posts', {
        method: 'POST',
        body: JSON.stringify({
          media_type: type,
          keys: uploads.map((u) => u.key),
          original_name: type === 'images' ? `${files.length} ảnh` : files[0].name,
          cover_ms: type === 'video' ? coverMs : null,
          description: desc,
          title,
          caption,
          hashtags: tags,
          scheduled_at: new Date(when).toISOString(),
          privacy,
          project_id: projectId || null,
        }),
      })
      // server luôn trả 201; kết quả gửi QPost nằm ở status (failed = QPost từ chối)
      if (j.status === 'failed') {
        setMsg('')
        useToasts.getState().push(`Gửi QPost thất bại (bài #${j.id}): ${j.error || 'không rõ lý do'}`, 'error')
      } else {
        const at = new Date(j.scheduled_at)
        setMsg('')
        useToasts.getState().push(
          at.getTime() - Date.now() > 60000
            ? `Đã gửi QPost thành công · bài #${j.id} sẽ đăng lúc ${at.toLocaleString('vi-VN')}`
            : `Đã gửi QPost thành công · bài #${j.id} đang được đăng`,
          'success',
        )
      }
      setVideo(null)
      clearImages()
      await load()
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      setMsg('Lỗi: ' + err)
      useToasts.getState().push('Không gửi được bài: ' + err, 'error')
    }
    setBusy(false)
  }

  const retry = async (id: number) => {
    try {
      await api('retry', { method: 'POST' }, `&id=${id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
    void load()
  }
  const removePost = async (id: number) => {
    try {
      await api('posts', { method: 'DELETE' }, `&id=${id}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
    void load()
  }
  const del = (id: number) => askConfirm({
    title: `Xoá bài #${id}?`,
    body: 'Bài và file trên R2 sẽ bị xoá khỏi Forest. Nếu bài đã gửi lên QPost, Forest chưa huỷ được lịch bên đó, cần kiểm tra trực tiếp trên QPost.',
    okLabel: 'Xoá bài',
    danger: true,
    onOk: () => void removePost(id),
  })
  // mỗi lần tải danh sách, server hỏi QPost trạng thái + link bài
  const runNow = async () => {
    setBusy(true)
    await load()
    setBusy(false)
  }

  // ---------- xem trước ----------
  const full = [title, caption, tags].map((s) => s.trim()).filter(Boolean).join('\n\n')

  // ---------- lightbox ----------
  useEffect(() => {
    if (!lb) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLb(null)
      if (e.key === 'ArrowLeft') setLb((s) => (s && s.i > 0 ? { ...s, i: s.i - 1 } : s))
      if (e.key === 'ArrowRight') setLb((s) => (s && s.i < s.items.length - 1 ? { ...s, i: s.i + 1 } : s))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [lb])

  const thumbsOf = (p: Post) => {
    if (p.media_type !== 'images' || !p.thumbs?.length) return null
    const urls = p.thumbs
    return (
      <div className="row" style={{ marginTop: 4, gap: 3 }}>
        {urls.slice(0, 6).map((src, i) => (
          <img
            key={src}
            src={src}
            alt={`Ảnh ${i + 1}`}
            loading="lazy"
            style={{ width: 28, height: 36, objectFit: 'cover', borderRadius: 3, cursor: 'zoom-in' }}
            onClick={() => setLb({ items: urls.map((u) => ({ src: u })), i })}
          />
        ))}
        {urls.length > 6 && <span className="small muted">+{urls.length - 6}</span>}
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Đăng TikTok</h1>
        <div className="row">
          <button className="btn ghost" onClick={() => void load()}><RefreshCw size={15} /> Tải lại</button>
          <button className="btn" disabled={busy} onClick={() => void runNow()}><Play size={15} /> Đồng bộ trạng thái</button>
          <button className={cx('btn', showCfg && 'dark')} onClick={() => setShowCfg((v) => !v)} aria-expanded={showCfg}>
            <Settings2 size={15} /> Cài đặt
          </button>
        </div>
      </div>
      {listErr && <div className="glass panel" style={{ color: 'var(--wine)', marginBottom: 16 }}>{listErr}</div>}
      {showCfg && (
        <TikTokSettingsPanel
          initial={cfg}
          onSaved={applyCfg}
          onClose={() => setShowCfg(false)}
          onChannelChange={() => {
            // đổi kênh: tải lại cài đặt của kênh mới
            api<TikTokSettings>('settings').then(applyCfg).catch((e) => setListErr(e instanceof Error ? e.message : String(e)))
            void load()
          }}
        />
      )}

      <div className="dash">
        {/* ---- form ---- */}
        <div className="glass panel" style={{ gridColumn: 'span 5' }}>
          <h3><Send size={18} /> Lên lịch bài đăng</h3>
          <p className="small muted" style={{ marginTop: -6 }}>Upload video hoặc ảnh → AI viết caption → vào hàng đợi → tự đăng qua QPost.</p>

          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            <button className={type === 'video' ? 'on' : ''} onClick={() => setType('video')}>🎬 Video</button>
            <button className={type === 'images' ? 'on' : ''} onClick={() => setType('images')}>🖼️ Ảnh</button>
          </div>

          {type === 'video' ? (
            <div className="list" style={{ marginTop: 12 }}>
              {video && (
                <div className="card row" style={{ alignItems: 'center' }}>
                  <span style={{ fontSize: 26 }} aria-hidden>🎬</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{video.name}</div>
                    <div className="small muted">{(video.size / 1048576).toFixed(1)} MB</div>
                  </div>
                  <button className="icon-btn" onClick={askRemoveVideo} aria-label="Bỏ video"><Trash2 size={15} /></button>
                </div>
              )}
              <label {...dropProps(pickVideo)} style={zoneStyle(dragOver, !!video)}>
                <input type="file" accept="video/*" hidden onChange={(e) => { if (e.target.files) pickVideo(e.target.files); e.target.value = '' }} />
                <Upload size={video ? 18 : 30} style={{ color: 'var(--wine)' }} />
                <b style={{ fontSize: video ? 13 : 15 }}>{video ? 'Kéo video khác vào để thay' : 'Kéo video vào đây'}</b>
                {!video && <span className="small muted">hoặc bấm để chọn file · mp4, mov, webm</span>}
              </label>
              <p className="small muted" style={{ margin: 0 }}>🔊 Giữ nguyên tiếng gốc. Nhạc trong video bạn tự chịu trách nhiệm bản quyền.</p>
              {videoUrl && (
                <div hidden={coverMs === null || coverErr}>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    muted
                    playsInline
                    preload="auto"
                    style={{ maxHeight: 320, maxWidth: '100%', display: 'block', margin: '0 auto', borderRadius: 8, background: '#000' }}
                    onLoadedMetadata={(e) => {
                      const dur = Math.floor((e.currentTarget.duration || 0) * 1000)
                      const max = Math.max(0, dur - 100)
                      const v = Math.min(cfg?.cover_ms ?? 1000, max) // mặc định theo Cài đặt (giây thứ 1)
                      setCoverMax(max)
                      setCoverMs(v)
                      e.currentTarget.currentTime = v / 1000
                    }}
                    onError={() => { if (videoUrl) { setCoverErr(true); setCoverMs(null) } }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={coverMax}
                    step={100}
                    value={coverMs ?? 0}
                    onChange={(e) => setCover(Number(e.target.value))}
                    style={{ width: '100%', marginTop: 8, accentColor: 'var(--wine)' }}
                    aria-label="Chọn ảnh bìa"
                  />
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                    <button className="btn ghost" onClick={() => setCover((coverMs ?? 0) - 100)} aria-label="Lùi 0,1 giây">◀</button>
                    <span className="small"><b>Ảnh bìa tại {fmtTime(coverMs ?? 0)}</b></span>
                    <button className="btn ghost" onClick={() => setCover((coverMs ?? 0) + 100)} aria-label="Tới 0,1 giây">▶</button>
                  </div>
                  <p className="small muted" style={{ margin: '4px 0 0' }}>TikTok không nhận ảnh bìa riêng qua API, chỉ chọn được một khung hình có trong video.</p>
                </div>
              )}
              {coverErr && (
                <p className="small muted">⚠️ Trình duyệt không xem trước được video này (thường là .mov/HEVC). TikTok sẽ lấy giây thứ 1 làm ảnh bìa.</p>
              )}
            </div>
          ) : (
            <div className="list" style={{ marginTop: 12 }}>
              <label {...dropProps(onPickImages)} style={zoneStyle(dragOver, images.length > 0)}>
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { onPickImages(e.target.files); e.target.value = '' }} />
                <Upload size={images.length ? 18 : 30} style={{ color: 'var(--wine)' }} />
                <b style={{ fontSize: images.length ? 13 : 15 }}>{images.length ? 'Kéo thêm ảnh vào đây' : 'Kéo ảnh vào đây'}</b>
                <span className="small muted">hoặc bấm để chọn · JPG, PNG, WEBP · tối đa {MAX_IMAGES} ảnh</span>
              </label>
              <p className="small muted" style={{ margin: 0 }}>🎵 TikTok sẽ tự chọn nhạc nền phù hợp cho bài ảnh. Bạn không chọn được bài nhạc cụ thể.</p>
              {images.length > 0 && (
                <>
                  <div className="small muted">Bấm ảnh để xem lớn, kéo thả hoặc dùng ← → để đổi thứ tự. Ảnh số 1 là ảnh đầu tiên người xem thấy.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
                    {images.map((it, i) => (
                      <div
                        key={it.id}
                        draggable
                        onDragStart={() => { dragFrom.current = i }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); if (dragFrom.current !== null) moveImage(dragFrom.current, i); dragFrom.current = null }}
                        onDragEnd={() => { dragFrom.current = null }}
                        style={{ position: 'relative', aspectRatio: '3 / 4', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line, rgba(0,0,0,.1))' }}
                        title={it.file.name}
                      >
                        <img
                          src={it.url}
                          alt={`Ảnh ${i + 1}`}
                          onClick={() => setLb({ items: images.map((x) => ({ src: x.url, name: x.file.name })), i })}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
                        />
                        <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 99 }}>{i + 1}</span>
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,.55)' }}>
                          <button className="icon-btn" style={{ color: '#fff' }} disabled={i === 0} onClick={() => moveImage(i, i - 1)} aria-label="Lên trước"><ChevronLeft size={14} /></button>
                          <button className="icon-btn" style={{ color: '#fff' }} onClick={() => removeImage(i)} aria-label="Bỏ ảnh"><X size={14} /></button>
                          <button className="icon-btn" style={{ color: '#fff' }} disabled={i === images.length - 1} onClick={() => moveImage(i, i + 1)} aria-label="Ra sau"><ChevronRight size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="list" style={{ marginTop: 14 }}>
            <label className="field">Nội dung bài đăng (mô tả để AI viết caption)
              <div className="row" style={{ marginTop: 0 }}>
                <select className="select grow" value={tplId} onChange={(e) => pickTemplate(e.target.value)} aria-label="Chọn mẫu nội dung">
                  <option value="">— Chọn mẫu đã lưu ({templates.length}) —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button className="icon-btn" onClick={() => void deleteTemplate()} disabled={!tplId} aria-label="Xoá mẫu đang chọn"><Trash2 size={15} /></button>
              </div>
            </label>
            <textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="VD: Review quán phở bò ở Hà Nội, nước dùng đậm, giá 50k..." />
            <div className="row" style={{ marginTop: 0 }}>
              {cfg?.ai_enabled === false
                ? <span className="small muted">AI viết caption chưa bật cho tài khoản này, bạn tự nhập bên dưới.</span>
                : <button className="btn ghost" onClick={() => void generate()}><Sparkles size={15} /> Sinh bằng AI</button>}
              <button className="btn ghost" onClick={() => void saveTemplate()}><Save size={15} /> Lưu thành mẫu</button>
              <span className="small muted">{genMsg}</span>
            </div>
            <label className="field">Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="field">Caption<textarea className="input" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
            <label className="field">Hashtag (5 cái)<input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#review #phobo #hanoi #reviewdoan #foodtiktok" /></label>
            <label className="field">Xem trước nội dung sẽ đăng <span className="small muted">{full ? `(${full.length}/${TITLE_MAX} ký tự)` : ''}</span>
              <div className="card" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: 10 }}>
                {full ? (
                  <>
                    {title.trim() && <b>{title.trim()}</b>}
                    {title.trim() && (caption.trim() || tags.trim()) ? '\n\n' : ''}
                    {caption.trim()}
                    {caption.trim() && tags.trim() ? '\n\n' : ''}
                    {tags.trim()}
                  </>
                ) : <span className="muted">Title, caption và hashtag sẽ hiện ở đây</span>}
              </div>
            </label>
            <label className="field">Dự án
              <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">— Không thuộc dự án —</option>
                {projects.filter((p) => p.status !== 'done' || p.id === projectId).map((p) => (
                  <option key={p.id} value={p.id}>{p.title}{p.kpiVideos ? ` (KPI ${p.kpiVideos} video/tháng)` : ''}</option>
                ))}
              </select>
              <span className="small muted">Bài gán dự án được tính vào KPI video của tháng đăng (xem ở mục Dự án).</span>
            </label>
            <label className="field">Giờ đăng<input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
            <div className="field">Ai được xem
              <div className="seg" role="radiogroup" aria-label="Quyền riêng tư" style={{ alignSelf: 'flex-start' }}>
                {PRIVACY_OPTIONS.map((o) => (
                  <button key={o.value} role="radio" aria-checked={privacy === o.value} className={privacy === o.value ? 'on' : ''} onClick={() => setPrivacy(o.value)}>{o.label}</button>
                ))}
              </div>
              <span className="small muted">{PRIVACY_OPTIONS.find((o) => o.value === privacy)?.hint} Mặc định lấy theo Cài đặt.</span>
            </div>
            <div className="row" style={{ marginTop: 0 }}>
              <button className="btn dark" disabled={busy} onClick={() => void submit()}>Thêm vào hàng đợi</button>
              {images.length > 0 && type === 'images' && (
                <button className="btn ghost" onClick={clearImages}><Undo2 size={15} /> Bỏ hết ảnh</button>
              )}
              <span className="small muted">{msg}</span>
            </div>
          </div>
        </div>

        {/* ---- hàng đợi ---- */}
        <div className="glass panel" style={{ gridColumn: 'span 7' }}>
          <h3>Hàng đợi</h3>
          <p className="small muted" style={{ marginTop: -6 }}>Bài được gửi lên QPost ngay khi thêm, QPost tự đăng đúng giờ, không cần bật máy. Trạng thái và link được cập nhật mỗi khi mở trang (và mỗi 30 giây).</p>
          <div className="list">
            {posts.map((p) => (
              <div key={p.id} className="card row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="small muted">
                    {p.media_type === 'images' ? `🖼️ ${p.original_name} · nhạc TikTok tự chọn` : `🎬 Video${p.cover_ms != null ? ` · bìa tại ${fmtTime(p.cover_ms)}` : ''}`}
                  </div>
                  <div style={{ fontWeight: 600 }}>{p.title || p.original_name}</div>
                  {thumbsOf(p)}
                  <div className="small muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: 360 }}>{p.caption}{'\n'}{p.hashtags}</div>
                  {p.error && <div className="small" style={{ color: 'var(--wine)' }}>{p.error}</div>}
                </div>
                <div style={{ textAlign: 'right', minWidth: 110 }}>
                  <div className="small muted">{new Date(p.scheduled_at).toLocaleString('vi-VN')}</div>
                  {p.project_id && <span className="tag" style={{ marginRight: 4 }}>📁 {projectName(p.project_id)}</span>}
                  {p.privacy === 'SELF_ONLY' && <span className="tag" style={{ marginRight: 4 }}>🔒 riêng tư</span>}
                  {p.privacy === 'MUTUAL_FOLLOW_FRIENDS' && <span className="tag" style={{ marginRight: 4 }}>👥 bạn bè</span>}
                  <span className={cx('tag', p.status === 'failed' && 'red')}>{STATUS_LABEL[p.status]}</span>
                  {p.post_url
                    ? <div><a href={p.post_url} target="_blank" rel="noopener noreferrer" className="small">Xem bài</a></div>
                    : p.status === 'posted' && <div className="small muted">Chờ TikTok công khai link…</div>}
                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                    {p.status === 'failed' && <button className="btn ghost" onClick={() => void retry(p.id)}>Thử lại</button>}
                    {p.status !== 'posting' && <button className="icon-btn" onClick={() => void del(p.id)} aria-label="Xoá bài"><Trash2 size={14} /></button>}
                  </div>
                </div>
              </div>
            ))}
            {posts.length === 0 && <div className="empty">Chưa có bài nào.</div>}
          </div>
        </div>
      </div>

      {confirmDlg && (
        <ConfirmDialog
          c={confirmDlg}
          onCancel={closeConfirm}
          onOk={() => { confirmDlg.onOk(); setConfirmDlg(null) }}
        />
      )}

      {/* ---- xem ảnh lớn ---- */}
      {lb && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setLb(null)}>
          <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <img src={lb.items[lb.i].src} alt={`Ảnh ${lb.i + 1}`} style={{ maxWidth: 'min(92vw, 900px)', maxHeight: 'calc(100vh - 90px)', objectFit: 'contain', borderRadius: 6 }} />
            <figcaption style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>
              Ảnh {lb.i + 1} / {lb.items.length}{lb.items[lb.i].name ? ` · ${lb.items[lb.i].name}` : ''}
            </figcaption>
          </figure>
          <button className="icon-btn" style={{ position: 'fixed', top: 14, right: 14, color: '#fff' }} onClick={() => setLb(null)} aria-label="Đóng"><X size={22} /></button>
          {lb.items.length > 1 && (
            <>
              <button className="icon-btn" style={{ position: 'fixed', left: 14, top: '50%', color: '#fff' }} disabled={lb.i === 0} onClick={() => setLb((s) => (s && s.i > 0 ? { ...s, i: s.i - 1 } : s))} aria-label="Ảnh trước"><ChevronLeft size={28} /></button>
              <button className="icon-btn" style={{ position: 'fixed', right: 14, top: '50%', color: '#fff' }} disabled={lb.i === lb.items.length - 1} onClick={() => setLb((s) => (s && s.i < s.items.length - 1 ? { ...s, i: s.i + 1 } : s))} aria-label="Ảnh sau"><ChevronRight size={28} /></button>
            </>
          )}
        </div>
      )}
    </>
  )
}
