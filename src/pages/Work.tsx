import { useMemo, useState } from 'react'
import { addMonths, endOfMonth, endOfWeek, isSameMonth, isToday, startOfMonth, startOfWeek, eachDayOfInterval } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { ContentItem, Kind, STATUS_LABEL, Status, useStore } from '../store'
import { ItemModal } from '../components/ItemModal'
import { Modal, useToasts } from '../components/ui'
import { cx, dkey, fmt } from '../lib/utils'

type Filter = 'product' | 'booking' | 'all'
type Entry = { item: ContentItem; due: boolean }

const MAX = 3
/** điện thoại: bấm ngày có mục sẽ mở danh sách thay vì thêm mục mới */
const isPhone = () => window.matchMedia('(max-width: 767px)').matches
const STATUS_COLOR: Record<Status, string> = { waiting: '#111', stock: '#6b1a24', posted: '#6f93a8' }

/** mục đang được kéo – kéo chip thường đổi `date`, kéo chip "Hạn đăng" đổi `deadline` */
type DragInfo = { id: string; field: 'date' | 'deadline' }
let dragging: DragInfo | null = null
const startDrag = (ev: React.DragEvent, info: DragInfo) => {
  dragging = info
  ev.dataTransfer.effectAllowed = 'move'
  ev.dataTransfer.setData('text/plain', info.id) // Firefox cần setData để bắt đầu kéo
  // đổi style ngay trong dragstart có thể làm Chrome huỷ thao tác kéo → hoãn 1 nhịp
  setTimeout(() => dragging && document.body.classList.add('is-dragging'))
}
const endDrag = () => {
  dragging = null
  document.body.classList.remove('is-dragging')
}

export function Chip({ e, onClick }: { e: Entry; onClick: () => void }) {
  const { item, due } = e
  const drag = {
    draggable: true,
    onDragStart: (ev: React.DragEvent) => startDrag(ev, { id: item.id, field: due ? 'deadline' : 'date' }),
    onDragEnd: endDrag,
  }
  if (due)
    return (
      <button {...drag} className="chip due" onClick={(ev) => { ev.stopPropagation(); onClick() }} title={`Hạn đăng: ${item.title} – kéo để đổi hạn`}>
        <span className="ex">!</span>
        <div style={{ minWidth: 0 }}>
          <b>Hạn đăng</b>
          <span style={{ display: 'block' }}>{item.title}</span>
        </div>
      </button>
    )
  return (
    <button
      {...drag}
      className={cx('chip', item.status === 'posted' ? 'posted' : item.kind)}
      onClick={(ev) => { ev.stopPropagation(); onClick() }}
      title={`${item.title} · ${item.brand} · ${STATUS_LABEL[item.status]}`}
    >
      {item.title}
    </button>
  )
}

export default function Work() {
  const items = useStore((s) => s.items).filter((i) => !i.archived)
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [filter, setFilter] = useState<Filter>('all')
  const [side, setSide] = useState<Kind>('product')
  const [edit, setEdit] = useState<Partial<ContentItem> | null>(null)
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null) // ô đang được kéo qua
  const { upsertItem, upsertTx } = useStore.getState()

  const dropOnDay = (day: string) => {
    const d = dragging
    endDrag()
    setOver(null)
    if (!d) return
    const it = items.find((i) => i.id === d.id)
    if (!it || it[d.field] === day) return
    upsertItem({ id: d.id, [d.field]: day })
    useToasts.getState().push(`${d.field === 'deadline' ? 'Đổi hạn đăng' : 'Dời lịch'} "${it.title}" → ${fmt(day, 'dd/MM')}`)
  }

  const dropOnStatus = (status: Status) => {
    const d = dragging
    endDrag()
    setOver(null)
    const it = d && items.find((i) => i.id === d.id)
    if (!it || it.status === status) return
    let paid = it.paid
    if (it.kind === 'booking' && status === 'posted' && it.fee && !paid) {
      upsertTx({ type: 'in', amount: it.fee, category: 'Booking', date: dkey(new Date()), note: `${it.brand} – ${it.title}` })
      paid = true
    }
    upsertItem({ id: it.id, status, paid })
    useToasts.getState().push(`"${it.title}" → ${STATUS_LABEL[status]}${paid && !it.paid ? ' · đã ghi thu vào Finance' : ''}`)
  }

  const dropZone = (key: string, onDrop: () => void) => ({
    onDragOver: (ev: React.DragEvent) => {
      if (!dragging) return
      ev.preventDefault()
      ev.dataTransfer.dropEffect = 'move'
      if (over !== key) setOver(key)
    },
    onDragLeave: (ev: React.DragEvent) => {
      if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setOver((o) => (o === key ? null : o))
    },
    onDrop: (ev: React.DragEvent) => { ev.preventDefault(); onDrop() },
  })

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) }),
    [month],
  )

  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>()
    const add = (k: string, e: Entry) => m.set(k, [...(m.get(k) ?? []), e])
    for (const it of items) {
      if (filter !== 'all' && it.kind !== filter) continue
      if (it.date) add(it.date, { item: it, due: false })
      if (it.kind === 'booking' && it.deadline && it.status !== 'posted') add(it.deadline, { item: it, due: true })
    }
    // đưa "hạn đăng" xuống cuối, giống mẫu
    m.forEach((list) => list.sort((a, b) => Number(a.due) - Number(b.due)))
    return m
  }, [items, filter])

  const sideItems = items.filter((i) => i.kind === side)

  return (
    <>
      <h1 className="page-title">Công việc</h1>
      <div className="work">
        <section className="glass stock">
          <div className="seg" style={{ alignSelf: 'stretch', display: 'flex' }}>
            {(['product', 'booking'] as const).map((k) => (
              <button key={k} style={{ flex: 1 }} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>
                {k === 'product' ? 'Kho sản phẩm' : 'Booking'}
              </button>
            ))}
          </div>
          <div className="stock-list">
            {(Object.keys(STATUS_LABEL) as Status[]).map((st) => {
              const list = sideItems.filter((i) => i.status === st)
              return (
                <div
                  key={st}
                  className={cx('status-zone', over === 'st-' + st && 'drop')}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                  {...dropZone('st-' + st, () => dropOnStatus(st))}
                >
                  <div className="group-h" style={{ color: STATUS_COLOR[st] }}>
                    <span className="ring" />
                    <span style={{ color: 'var(--ink)' }}>{STATUS_LABEL[st]}</span>
                    <span className="count">· {list.length}</span>
                  </div>
                  {list.map((i) => (
                    <div
                      key={i.id}
                      className="card"
                      onClick={() => setEdit(i)}
                      draggable
                      onDragStart={(ev) => startDrag(ev, { id: i.id, field: 'date' })}
                      onDragEnd={() => { endDrag(); setOver(null) }}
                      title="Kéo lên lịch để lên ngày, hoặc sang nhóm khác để đổi trạng thái"
                    >
                      <div>{i.title}</div>
                      <div className="b">
                        {i.brand}
                        {i.deadline && i.status !== 'posted' && <> · hạn {fmt(i.deadline, 'dd/MM')}</>}
                      </div>
                    </div>
                  ))}
                  {list.length === 0 && <div className="empty">Trống</div>}
                </div>
              )
            })}
          </div>
          <button className="btn dark" style={{ justifyContent: 'center' }} onClick={() => setEdit({ kind: side })}>
            <Plus size={16} /> Thêm {side === 'product' ? 'sản phẩm' : 'booking'}
          </button>
        </section>

        <section className="cal">
          <div className="cal-head">
            <h2>{fmt(month, "'Tháng' M, yyyy")}</h2>
            <div className="seg">
              {(['product', 'booking', 'all'] as Filter[]).map((k) => (
                <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  {k === 'product' ? 'Sản phẩm' : k === 'booking' ? 'Booking' : 'Tất cả'}
                </button>
              ))}
            </div>
            <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Tháng trước"><ChevronLeft size={18} /></button>
            <span className="btn" style={{ minWidth: 110, justifyContent: 'center' }}>Tháng {month.getMonth() + 1}</span>
            <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Tháng sau"><ChevronRight size={18} /></button>
            <button className="btn" onClick={() => setMonth(startOfMonth(new Date()))}>Hôm nay</button>
          </div>
          <div className="dow">
            {['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="cal-grid">
            {days.map((day) => {
              const k = dkey(day)
              const list = byDay.get(k) ?? []
              return (
                <div
                  key={k}
                  className={cx('day', !isSameMonth(day, month) && 'out', isToday(day) && 'today', over === k && 'drop')}
                  onClick={() =>
                    list.length && isPhone()
                      ? setDayOpen(k)
                      : setEdit({ date: k, kind: filter === 'booking' ? 'booking' : 'product' })
                  }
                  title="Bấm để thêm mục vào ngày này"
                  {...dropZone(k, () => dropOnDay(k))}
                >
                  <span className="num">{day.getDate()}</span>
                  {list.slice(0, MAX).map((e) => (
                    <Chip key={e.item.id + e.due} e={e} onClick={() => setEdit(e.item)} />
                  ))}
                  {list.length > MAX && (
                    <button className="more" onClick={(ev) => { ev.stopPropagation(); setDayOpen(k) }}>
                      +{list.length - MAX} mục khác
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {dayOpen && (
        <Modal title={fmt(dayOpen, 'EEEE, dd/MM/yyyy')} onClose={() => setDayOpen(null)}>
          {(byDay.get(dayOpen) ?? []).map((e) => (
            <Chip key={e.item.id + e.due} e={e} onClick={() => { setDayOpen(null); setEdit(e.item) }} />
          ))}
          <div className="modal-actions">
            <button className="btn dark" onClick={() => { setEdit({ date: dayOpen }); setDayOpen(null) }}><Plus size={15} /> Thêm</button>
          </div>
        </Modal>
      )}
      {edit && <ItemModal item={edit} onClose={() => setEdit(null)} />}
    </>
  )
}
