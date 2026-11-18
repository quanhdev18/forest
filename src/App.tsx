import { useEffect, useState } from 'react'
import {
  LayoutDashboard, CalendarDays, BellRing, CircleDollarSign, NotebookPen, Network, Trees,
  Archive, Settings as Cog, Flame, Lightbulb,
} from 'lucide-react'
import { useStore } from './store'
import { ForestBg } from './components/ForestBg'
import { Toasts, useToasts } from './components/ui'
import { useRelax } from './pages/Relax'
import { noise } from './lib/noise'
import { handleCallback } from './lib/spotify'
import { initSync } from './lib/sync'
import { startFxAutoRefresh } from './lib/fx'
import { cx } from './lib/utils'
import { addDays, addWeeks } from 'date-fns'

import Dashboard from './pages/Dashboard'
import Work from './pages/Work'
import Ideas from './pages/Ideas'
import Reminders from './pages/Reminders'
import Habits from './pages/Habits'
import Finance from './pages/Finance'
import Notes from './pages/Notes'
import Projects from './pages/Projects'
import Relax from './pages/Relax'
import Settings from './pages/Settings'
import ArchivePage from './pages/Archive'

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, el: Dashboard },
  { id: 'work', label: 'Công việc', icon: CalendarDays, el: Work },
  { id: 'ideas', label: 'Ý tưởng', icon: Lightbulb, el: Ideas },
  { id: 'reminder', label: 'Reminder', icon: BellRing, el: Reminders },
  { id: 'habits', label: 'Thói quen', icon: Flame, el: Habits },
  { id: 'finance', label: 'Finance', icon: CircleDollarSign, el: Finance },
  { id: 'notes', label: 'Quick Note', icon: NotebookPen, el: Notes },
  { id: 'project', label: 'Project', icon: Network, el: Projects },
  { id: 'relax', label: 'Relax', icon: Trees, el: Relax },
] as const
const BOTTOM = [
  { id: 'archive', label: 'Lưu trữ', icon: Archive, el: ArchivePage },
  { id: 'settings', label: 'Cài đặt', icon: Cog, el: Settings },
] as const
const ALL = [...NAV, ...BOTTOM]

function useHashRoute() {
  const get = () => location.hash.replace('#/', '') || 'dashboard'
  const [route, setRoute] = useState(get)
  useEffect(() => {
    const h = () => setRoute(get())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return route
}

/** Kiểm tra reminder mỗi 15 giây */
function useReminderWatcher() {
  const push = useToasts((s) => s.push)
  useEffect(() => {
    const tick = () => {
      const { reminders, upsertReminder } = useStore.getState()
      const now = Date.now()
      for (const r of reminders) {
        if (r.done || new Date(r.at).getTime() > now || r.firedAt === r.at) continue
        push(`⏰ ${r.title}`, 'reminder')
        const st = useStore.getState().settings
        noise.alarm(st.alarmSound ?? 'bell', !!st.alarmRepeat)
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Forest – Nhắc việc', { body: r.title })
        }
        if (r.repeat === 'none') upsertReminder({ id: r.id, firedAt: r.at })
        else {
          let next = new Date(r.at)
          while (next.getTime() <= now) next = r.repeat === 'daily' ? addDays(next, 1) : addWeeks(next, 1)
          upsertReminder({ id: r.id, at: next.toISOString(), firedAt: undefined })
        }
      }
    }
    tick()
    const t = setInterval(tick, 15000)
    return () => clearInterval(t)
  }, [push])
}

function SideNote() {
  const [text, setText] = useState('')
  const upsertNote = useStore((s) => s.upsertNote)
  const save = () => {
    if (!text.trim()) return
    upsertNote({ text: text.trim(), pinned: false })
    setText('')
    useToasts.getState().push('Đã lưu vào Quick Note')
  }
  return (
    <div className="side-note">
      <div className="row">
        <span className="side-label" style={{ padding: '6px 2px' }}>Quick note</span>
        <button onClick={save}>↵ Lưu</button>
      </div>
      <textarea
        placeholder="Đang nghĩ gì? Gõ ở đây... (Ctrl+Enter để lưu)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && save()}
      />
    </div>
  )
}

export default function App() {
  const route = useHashRoute()
  const settings = useStore((s) => s.settings)
  const playing = useRelax((s) => Object.keys(s.playing).length > 0)
  useReminderWatcher()

  useEffect(() => {
    handleCallback()
    initSync()
    return startFxAutoRefresh()
  }, [])

  useEffect(() => {
    const r = document.documentElement.style
    r.setProperty('--blur', settings.blur + 'px')
    r.setProperty('--glass', `rgba(255,255,255,${settings.glass})`)
    r.setProperty('--glass-strong', `rgba(255,255,255,${Math.min(1, settings.glass + 0.25)})`)
    r.setProperty('--accent', settings.accent)
    r.setProperty('--wine', settings.accent)
  }, [settings])

  // link cũ #/theme (Màu & kính) nay nằm trong Cài đặt
  const Page = ALL.find((n) => n.id === (route === 'theme' ? 'settings' : route))?.el ?? Dashboard
  const link = (n: (typeof ALL)[number]) => (
    <button key={n.id} className={cx('nav', route === n.id && 'active')} onClick={() => (location.hash = '#/' + n.id)}>
      <n.icon size={20} strokeWidth={2.2} /><span className="lbl">{n.label}</span>
      {n.id === 'relax' && playing && <span className="dot" title="Đang phát" />}
    </button>
  )

  return (
    <div className="app">
      <ForestBg scene={settings.scene} />
      <aside className="sidebar">
        <div className="brand">
          <Trees size={28} /> <span className="sep" /> <span className="brand-name">Forest</span>
        </div>
        <div className="side-label">Workspace</div>
        {NAV.map(link)}
        <div className="side-spacer" />
        {BOTTOM.map(link)}
        <SideNote />
      </aside>
      <main className="main">
        <Page />
      </main>
      <Toasts />
    </div>
  )
}
