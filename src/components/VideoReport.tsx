import { useEffect, useMemo, useState } from 'react'
import { addMonths, getDaysInMonth, startOfMonth } from 'date-fns'
import { AlertTriangle, BarChart3, CheckCircle2, Clock, Target } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/tiktokApi'
import { fmt } from '../lib/utils'

// Báo cáo ở Dashboard: số video theo dự án (KPI tháng này) + số video 6 tháng gần nhất.
// "Video" = bài ở mục Đăng TikTok (video hoặc ảnh), tính theo giờ đăng, không tính bài lỗi.

interface Row { project_id: string | null; status: string; scheduled_at: string }
const MONTHS = 6
const go = (r: string) => (location.hash = '#/' + r)

function useReport() {
  const [rows, setRows] = useState<Row[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const start = startOfMonth(addMonths(new Date(), -(MONTHS - 1)))
    const end = startOfMonth(addMonths(new Date(), 1))
    api<{ rows: Row[]; needs_sql: boolean }>('report', {}, `&from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`)
      .then((r) => {
        setRows(r.rows)
        setNote(r.needs_sql ? 'Chưa có dữ liệu dự án: chạy lại file supabase/tiktok.sql trên Supabase.' : null)
      })
      .catch((e) => setNote('Chưa lấy được số liệu từ mục Đăng TikTok: ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => setLoading(false))
  }, [])
  return { rows, note, loading }
}

function Bar({ value, max, done }: { value: number; max: number; done?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 6, borderRadius: 4, background: 'rgba(0,0,0,.08)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: done ? '#1e7a45' : 'var(--accent)', borderRadius: 4, transition: 'width .3s' }} />
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: '10px 12px' }}>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2 }}>{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  )
}

type Pace = 'done' | 'ontrack' | 'behind'
const PACE: Record<Pace, { icon: typeof CheckCircle2; color: string }> = {
  done: { icon: CheckCircle2, color: '#1e7a45' },
  ontrack: { icon: Clock, color: 'var(--ink-2)' },
  behind: { icon: AlertTriangle, color: 'var(--wine)' },
}

export function VideoReport() {
  const projects = useStore((s) => s.projects)
  const { rows, note, loading } = useReport()
  const [hover, setHover] = useState<number | null>(null)

  const now = new Date()
  const mk = fmt(now, 'yyyy-MM')
  const prevMk = fmt(addMonths(now, -1), 'yyyy-MM')
  const day = now.getDate()
  const days = getDaysInMonth(now)

  const data = useMemo(() => {
    const monthOf = (r: Row) => fmt(new Date(r.scheduled_at), 'yyyy-MM')
    const cur = rows.filter((r) => monthOf(r) === mk)
    const byProject: Record<string, number> = {}
    for (const r of cur) if (r.project_id) byProject[r.project_id] = (byProject[r.project_id] ?? 0) + 1

    // 6 tháng gần nhất, cũ -> mới
    const months = Array.from({ length: MONTHS }, (_, i) => {
      const d = startOfMonth(addMonths(now, i - (MONTHS - 1)))
      const k = fmt(d, 'yyyy-MM')
      const list = rows.filter((r) => monthOf(r) === k)
      return { k, d, total: list.length, posted: list.filter((r) => r.status === 'posted').length }
    })

    // dự án có KPI hoặc có video tháng này; chậm tiến độ lên đầu
    const items = projects
      .filter((p) => p.kpiVideos || byProject[p.id])
      .map((p) => {
        const n = byProject[p.id] ?? 0
        const kpi = p.kpiVideos ?? 0
        const expected = Math.floor((kpi * day) / days) // số video nên có tới hôm nay
        const pace: Pace | null = !kpi ? null : n >= kpi ? 'done' : n >= expected ? 'ontrack' : 'behind'
        return { p, n, kpi, expected, pace }
      })
      .sort((a, b) => {
        const rank = (x: typeof a) => (x.pace === 'behind' ? 0 : x.pace === 'ontrack' ? 1 : x.pace === 'done' ? 2 : 3)
        return rank(a) - rank(b) || b.n - a.n
      })

    const withKpi = items.filter((x) => x.kpi > 0)
    const kpiTotal = withKpi.reduce((s, x) => s + x.kpi, 0)
    const kpiDone = withKpi.reduce((s, x) => s + Math.min(x.n, x.kpi), 0)
    return {
      total: cur.length,
      posted: cur.filter((r) => r.status === 'posted').length,
      prev: rows.filter((r) => monthOf(r) === prevMk).length,
      unassigned: cur.filter((r) => !r.project_id).length,
      months,
      items,
      kpiTotal,
      kpiPct: kpiTotal ? Math.round((kpiDone / kpiTotal) * 100) : null,
    }
  }, [rows, projects, mk, prevMk, day, days]) // eslint-disable-line react-hooks/exhaustive-deps

  const diff = data.total - data.prev
  const maxBar = Math.max(1, ...data.months.map((m) => m.total))
  const hovered = hover !== null ? data.months[hover] : null

  return (
    <>
      {/* ---------- KPI tháng này theo dự án ---------- */}
      <div className="glass panel" style={{ gridColumn: 'span 8' }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 className="grow" style={{ margin: 0 }}><Target size={18} /> Báo cáo video tháng {fmt(now, 'M/yyyy')}</h3>
          <button className="btn ghost" onClick={() => go('project')}>Đặt KPI →</button>
        </div>
        {note && <div className="small" style={{ color: 'var(--wine)', marginBottom: 8 }}>{note}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 14 }}>
          <Tile
            label="Video tháng này"
            value={loading ? '…' : String(data.total)}
            sub={loading ? undefined : diff === 0 ? 'bằng tháng trước' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} so với tháng trước`}
          />
          <Tile label="Đã đăng" value={loading ? '…' : String(data.posted)} />
          <Tile label="Đang chờ đăng" value={loading ? '…' : String(data.total - data.posted)} sub="đã lên lịch" />
          <Tile
            label="Hoàn thành KPI"
            value={data.kpiPct === null ? '—' : `${data.kpiPct}%`}
            sub={data.kpiPct === null ? 'chưa đặt KPI' : `ngày ${day}/${days} của tháng`}
          />
        </div>

        {data.items.length === 0 ? (
          <div className="empty">
            {projects.length === 0
              ? 'Chưa có dự án. Tạo dự án và đặt KPI video/tháng ở mục Dự án.'
              : 'Chưa đặt KPI cho dự án nào. Bấm vào dự án ở mục Dự án để đặt KPI video/tháng.'}
          </div>
        ) : (
          <div className="list" style={{ gap: 10 }}>
            {data.items.map(({ p, n, kpi, expected, pace }) => {
              const P = pace ? PACE[pace] : null
              return (
                <div key={p.id}>
                  <div className="row" style={{ marginTop: 0, marginBottom: 4, gap: 8, flexWrap: 'wrap' }}>
                    <span className="grow" style={{ fontWeight: 600, minWidth: 0 }}>{p.title}</span>
                    <span className="small"><b>{n}</b>{kpi ? `/${kpi}` : ''} video</span>
                    {P && (
                      <span className="small" style={{ color: P.color, display: 'inline-flex', gap: 4, alignItems: 'center', fontWeight: 600 }}>
                        <P.icon size={13} />
                        {pace === 'done' ? 'Đạt KPI' : pace === 'ontrack' ? 'Đúng tiến độ' : `Chậm ${expected - n} video`}
                      </span>
                    )}
                    {!kpi && <span className="small muted">chưa đặt KPI</span>}
                  </div>
                  {kpi > 0 && <Bar value={n} max={kpi} done={pace === 'done'} />}
                </div>
              )
            })}
          </div>
        )}
        {data.unassigned > 0 && (
          <div className="small muted" style={{ marginTop: 10 }}>
            + {data.unassigned} video không thuộc dự án — gán dự án khi đăng ở mục Đăng TikTok để tính KPI.
          </div>
        )}
      </div>

      {/* ---------- 6 tháng gần nhất ---------- */}
      <div className="glass panel" style={{ gridColumn: 'span 4' }}>
        <h3><BarChart3 size={18} /> Video 6 tháng gần nhất</h3>
        <div
          role="img"
          aria-label={`Số video mỗi tháng: ${data.months.map((m) => `tháng ${fmt(m.d, 'M')}: ${m.total}`).join(', ')}`}
          style={{ position: 'relative', marginTop: 4 }}
          onMouseLeave={() => setHover(null)}
        >
          {/* tooltip */}
          <div
            className="small"
            style={{
              minHeight: 34, marginBottom: 6, color: 'var(--ink-2)',
              visibility: hovered ? 'visible' : 'hidden',
            }}
          >
            {hovered && (
              <>
                <b>Tháng {fmt(hovered.d, 'M/yyyy')}</b>
                <div>{hovered.total} video · {hovered.posted} đã đăng</div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, borderBottom: '1px solid var(--line)' }}>
            {data.months.map((m, i) => {
              const isCur = m.k === mk
              return (
                <div
                  key={m.k}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={0}
                  aria-label={`Tháng ${fmt(m.d, 'M/yyyy')}: ${m.total} video, ${m.posted} đã đăng`}
                  style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', cursor: 'default', outline: 'none' }}
                >
                  {/* chỉ ghi số trên cột tháng này (nhãn chọn lọc) */}
                  {isCur && <div className="small" style={{ fontWeight: 700, marginBottom: 3 }}>{m.total}</div>}
                  <div
                    style={{
                      width: '62%', maxWidth: 30,
                      height: `${(m.total / maxBar) * 100}%`, minHeight: m.total ? 3 : 0,
                      background: 'var(--accent)',
                      opacity: hover === null || hover === i ? 1 : 0.45,
                      borderRadius: '4px 4px 0 0', transition: 'opacity .15s, height .3s',
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {data.months.map((m) => (
              <div key={m.k} className="small" style={{ flex: 1, textAlign: 'center', fontWeight: m.k === mk ? 700 : 400, color: m.k === mk ? 'var(--ink)' : 'var(--ink-3)' }}>
                T{fmt(m.d, 'M')}
              </div>
            ))}
          </div>
        </div>
        <p className="small muted" style={{ margin: '10px 0 0' }}>Di chuột vào cột để xem chi tiết. Tính theo giờ đăng, không tính bài lỗi.</p>
      </div>
    </>
  )
}
