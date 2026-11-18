import { useRef, useState } from 'react'
import { BellRing, Download, ImagePlus, Play, Undo2, Upload } from 'lucide-react'
import { Settings as S, useStore } from '../store'
import { useToasts } from '../components/ui'
import { CloudPanel } from '../components/CloudPanel'
import { ALARM_SOUNDS, noise } from '../lib/noise'
import { cx, dkey } from '../lib/utils'

const ACCENTS = ['#6b1a24', '#1d1d1f', '#3f6d55', '#5d7f93', '#9a5b1f', '#6a4c93']
const SCENES: [S['scene'], string][] = [['forest', 'Rừng sương'], ['dusk', 'Hoàng hôn'], ['lake', 'Hồ nước']]

/** Thu nhỏ ảnh về tối đa 1920px và nén JPEG để không đầy localStorage (giới hạn ~5 MB) */
async function compressImage(file: File): Promise<string> {
  const src = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = src
    })
    const MAX_CHARS = 1_500_000
    let side = 1920
    let quality = 0.85
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, side / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      const url = c.toDataURL('image/jpeg', quality)
      if (url.length <= MAX_CHARS) return url
      side = Math.round(side * 0.8)
      quality = Math.max(0.5, quality - 0.1)
    }
    throw new Error('too large')
  } finally {
    URL.revokeObjectURL(src)
  }
}

export default function Settings() {
  const { settings, setSettings, importAll } = useStore()
  const file = useRef<HTMLInputElement>(null)

  const exportJson = () => {
    const { items, reminders, habits, transactions, notes, projects, settings, ideas } = useStore.getState()
    const blob = new Blob([JSON.stringify({ items, reminders, habits, transactions, notes, projects, settings, ideas }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `forest-backup-${dkey(new Date())}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = async (f: File) => {
    try {
      const data = JSON.parse(await f.text())
      if (!Array.isArray(data.items)) throw new Error()
      if (!confirm('Nhập file sẽ ghi đè toàn bộ dữ liệu hiện tại. Tiếp tục?')) return
      importAll(data)
      useToasts.getState().push('Đã nhập dữ liệu')
    } catch {
      useToasts.getState().push('File không hợp lệ')
    }
  }

  const bgFile = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const uploadBg = async (f: File) => {
    if (!f.type.startsWith('image/')) return useToasts.getState().push('Chỉ chọn file ảnh')
    if (f.size > 25 * 1024 * 1024) return useToasts.getState().push('Ảnh quá lớn (tối đa 25 MB)')
    setBusy(true)
    try {
      const url = await compressImage(f)
      setSettings({ customBg: url })
      useToasts.getState().push('Đã đổi ảnh nền')
    } catch {
      useToasts.getState().push('Không đọc được ảnh này')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="page-title">Cài đặt</h1>
      <div className="dash" style={{ marginBottom: 16 }}>
        <div style={{ gridColumn: 'span 12' }}>
          <CloudPanel />
        </div>
      </div>
      <div className="dash" style={{ marginBottom: 16 }}>
        <div className="glass panel" style={{ gridColumn: 'span 12' }}>
          <h3>Ảnh nền</h3>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="bg-preview" style={settings.customBg ? { backgroundImage: `url("${settings.customBg}")` } : undefined}>
              {!settings.customBg && <span className="small muted">Khung cảnh có sẵn</span>}
            </div>
            <div className="list" style={{ flex: 1, minWidth: 220 }}>
              <p className="small muted" style={{ margin: 0 }}>
                Chọn ảnh từ máy để làm nền. Ảnh sẽ được thu nhỏ tự động và lưu trong trình duyệt này.
              </p>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn dark" disabled={busy} onClick={() => bgFile.current?.click()}>
                  <ImagePlus size={15} /> {busy ? 'Đang xử lý…' : 'Tải ảnh lên'}
                </button>
                {settings.customBg && (
                  <button className="btn" onClick={() => setSettings({ customBg: undefined })}>
                    <Undo2 size={15} /> Về khung cảnh có sẵn
                  </button>
                )}
                <input
                  ref={bgFile}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBg(f); e.target.value = '' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="dash">
        <div className="glass panel" style={{ gridColumn: 'span 6' }}>
          <h3>Giao diện</h3>
          <div className="list">
            <label className="field">Khung cảnh nền
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                {SCENES.map(([k, v]) => <button key={k} className={settings.scene === k ? 'on' : ''} onClick={() => setSettings({ scene: k })}>{v}</button>)}
              </div>
            </label>
            <label className="field">Màu nhấn
              <div className="row">
                {ACCENTS.map((c) => (
                  <button key={c} onClick={() => setSettings({ accent: c })} className={cx('hcell')} aria-label={c}
                    style={{ background: c, outline: settings.accent === c ? '2px solid var(--ink)' : undefined, outlineOffset: 2 }} />
                ))}
              </div>
            </label>
            <label className="field">Độ mờ kính: {settings.blur}px
              <input type="range" min={0} max={40} value={settings.blur} onChange={(e) => setSettings({ blur: +e.target.value })} />
            </label>
            <label className="field">Độ trong của kính: {Math.round(settings.glass * 100)}%
              <input type="range" min={0.15} max={0.95} step={0.01} value={settings.glass} onChange={(e) => setSettings({ glass: +e.target.value })} />
            </label>
          </div>
        </div>
        <div className="glass panel" style={{ gridColumn: 'span 6' }}>
          <h3><BellRing size={18} /> Chuông báo nhắc việc</h3>
          <div className="list">
            <label className="field">Âm báo
              <div className="row">
                <select
                  className="select grow"
                  value={settings.alarmSound ?? 'bell'}
                  onChange={(e) => setSettings({ alarmSound: e.target.value as S['alarmSound'] })}
                >
                  {ALARM_SOUNDS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button className="btn" onClick={() => noise.chime(settings.alarmSound ?? 'bell')} aria-label="Nghe thử">
                  <Play size={15} /> Nghe thử
                </button>
              </div>
            </label>
            <label className="field row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
              <span>Lặp lại chuông (kêu 3 lần, cách nhau 4 giây)</span>
              <input
                type="checkbox"
                checked={!!settings.alarmRepeat}
                onChange={(e) => setSettings({ alarmRepeat: e.target.checked })}
              />
            </label>
          </div>
        </div>
        <div className="glass panel" style={{ gridColumn: 'span 6' }}>
          <h3>Sao lưu dữ liệu</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Dữ liệu đang lưu trong trình duyệt này. Hãy xuất file JSON định kỳ để không bị mất khi đổi máy hoặc xoá cache.
          </p>
          <div className="row">
            <button className="btn dark" onClick={exportJson}><Download size={15} /> Xuất JSON</button>
            <button className="btn" onClick={() => file.current?.click()}><Upload size={15} /> Nhập JSON</button>
            <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </div>
        </div>
      </div>
    </>
  )
}
