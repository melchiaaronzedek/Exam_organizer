import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AppCtx, type AppState } from './ctx'
import type { DocumentsFile, Exam, ExamOverride, ExamsFile, OpportunitiesFile, PhaseOverride, Profile, ScrapeStatusFile, UpdatesFile } from './types'
import { buildEvents, isFresh, loadAll, mergeExam } from './lib/data'
import { restoreKey } from './lib/lock'
import { Lock } from './components/Lock'
import { customExamsStore, jobsStore, overridesStore, prefsStore, seenStore } from './lib/storage'
import { listDocs } from './lib/vault'
import { maybeNotify, dueEvents } from './lib/notify'
import { useEntrance } from './lib/useEntrance'
import { useIsPhone } from './lib/useIsPhone'
import { Icon } from './components/Icon'
import { DashboardSkeleton } from './components/Skeleton'
import { Logo } from './components/Logo'
import { daysUntil } from './lib/dates'
import { TabBar } from './components/TabBar'
import { Sheet } from './components/Sheet'
import { Command } from './components/Command'
import { Toasts } from './components/Toasts'
import { Dashboard } from './views/Dashboard'
import { Exams } from './views/Exams'
import { Jobs } from './views/Jobs'
import { Calendar } from './views/Calendar'
import { Updates } from './views/Updates'
import { Documents } from './views/Documents'
import { Settings } from './views/Settings'
import { More } from './views/More'
import { format } from 'date-fns'

const NAV = [
  { id: 'dashboard', label: 'Desk', icon: 'dashboard' },
  { id: 'exams', label: 'Exams', icon: 'exams' },
  { id: 'jobs', label: 'Jobs', icon: 'list' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'updates', label: 'Updates', icon: 'updates' },
  { id: 'documents', label: 'Documents', icon: 'documents' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const
const PHONE_TABS = ['dashboard', 'exams', 'jobs', 'calendar'] as const
const MORE_ITEMS = ['updates', 'documents', 'settings'] as const
const TITLES: Record<string, string> = { dashboard: 'Desk', exams: 'Exams', jobs: 'Jobs', calendar: 'Calendar', updates: 'Updates', documents: 'Documents', settings: 'Settings' }

function readHash() {
  const h = location.hash.replace(/^#\/?/, '')
  return NAV.some((n) => n.id === h) ? h : 'dashboard'
}

export function App() {
  const [view, setView] = useState(readHash)
  const [instant, setInstant] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [update, setUpdate] = useState<ServiceWorkerRegistration | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const [pillY, setPillY] = useState(0)
  const pre = useEntrance([view])
  const isPhone = useIsPhone()
  const [data, setData] = useState<{ exams: ExamsFile; updates: UpdatesFile; status: ScrapeStatusFile; documents: DocumentsFile; profile: Profile; opportunities: OpportunitiesFile } | null>(null)
  const [docCounts, setDocCounts] = useState<Record<string, number>>({})
  const [locked, setLocked] = useState<boolean | null>(null) // null = checking the build's lock
  const overrides = overridesStore.use()
  const custom = customExamsStore.use()
  const prefs = prefsStore.use()
  const seen = seenStore.use()
  const jobs = jobsStore.use()

  useEffect(() => {
    restoreKey().then((open) => {
      setLocked(!open)
      if (open) loadAll().then(setData)
    })
    const onHash = () => setView(readHash())
    window.addEventListener('hashchange', onHash)
    const onUpdate = (e: Event) => setUpdate((e as CustomEvent<ServiceWorkerRegistration>).detail)
    window.addEventListener('pd:update-available', onUpdate)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('pd:update-available', onUpdate)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', prefs.theme === 'ink' ? '#0b0d12' : '#f4f1ea')
  }, [prefs.theme])

  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('.nav__item.is-active')
    if (el) setPillY(el.offsetTop)
  }, [view, isPhone])

  const navigate = useCallback((v: string, viaKeyboard = false) => {
    setMoreOpen(false)
    setCmdOpen(false)
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const go = () => {
      location.hash = `/${v}`
      setView(v)
    }
    if (doc.startViewTransition && !reduce && v !== readHash()) {
      // Cross-fade the whole page; the per-card entrance would double up, so skip it.
      setInstant(true)
      window.scrollTo({ top: 0, behavior: 'auto' })
      doc.startViewTransition(() => flushSync(go))
    } else {
      setInstant(viaKeyboard)
      go()
      window.scrollTo({ top: 0, behavior: viaKeyboard ? 'auto' : 'smooth' })
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen((v) => !v)
        return
      }
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        setHelpOpen(false)
        return
      }
      const idx = Number(e.key) - 1
      if (idx >= 0 && idx < NAV.length) navigate(NAV[idx].id, true)
      if (e.key === '/') {
        e.preventDefault()
        navigate('exams', true)
        setTimeout(() => document.getElementById('exam-search')?.focus(), 50)
      }
      if (e.key === 't') prefsStore.set((p) => ({ ...p, theme: p.theme === 'ink' ? 'paper' : 'ink' }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const refreshDocCounts = useCallback(() => {
    listDocs().then((docs) => {
      const c: Record<string, number> = {}
      for (const d of docs) c[d.examId] = (c[d.examId] ?? 0) + 1
      setDocCounts(c)
    })
  }, [])
  useEffect(() => {
    refreshDocCounts()
  }, [refreshDocCounts])

  const exams: Exam[] = useMemo(() => {
    const base = data?.exams.exams ?? []
    return [...base, ...custom.list].map((e) => mergeExam(e, overrides[e.id]))
  }, [data, custom, overrides])
  const events = useMemo(() => buildEvents(exams, overrides), [exams, overrides])
  useEffect(() => {
    if (events.length) maybeNotify(events)
  }, [events])

  const state: AppState = {
    exams,
    events,
    updates: data?.updates ?? { updatedAt: null, updates: [] },
    status: data?.status ?? { lastRun: null, sources: [] },
    documents: data?.documents.documents ?? [],
    profile: data?.profile ?? { headline: '', education: [], ageOn: '', qualifications: [], roles: [], sectors: [], excludeTerms: [], homeStates: [], cities: [], minPayLakh: 0 },
    opportunities: data?.opportunities ?? { curated: [], discovered: [] },
    isPhone,
    overrides,
    generatedAt: data?.exams.generatedAt ?? '',
    docCounts,
    refreshDocCounts,
    setOverride: (id, patch) => overridesStore.set((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } })),
    setPhase: (id, pid, patch: PhaseOverride) =>
      overridesStore.set((prev) => {
        const ex: ExamOverride = prev[id] ?? {}
        return { ...prev, [id]: { ...ex, phases: { ...ex.phases, [pid]: { ...ex.phases?.[pid], ...patch } } } }
      }),
    addCustomExam: (exam) => customExamsStore.set((p) => ({ list: [...p.list, exam] })),
    removeCustomExam: (id) => customExamsStore.set((p) => ({ list: p.list.filter((e) => e.id !== id) })),
    navigate,
  }

  const dueCount = dueEvents(events, prefs.leadDays).length
  const nextExam = events.find((e) => e.kind === 'exam' && e.status !== 'done' && daysUntil(e.date)! >= 0)
  const nextDays = nextExam ? daysUntil(nextExam.date)! : null
  const ringProgress = nextDays == null ? 0.08 : Math.max(0.08, 1 - Math.min(nextDays, 30) / 30)
  const examToday = nextDays === 0
  const unread = (data?.updates.updates ?? []).filter((u) => isFresh(u) && !seen.ids.includes(u.id)).length
  const openJobs = data ? [...data.opportunities.curated, ...data.opportunities.discovered, ...(data.opportunities.portal ?? [])].filter((o) => o.status === 'open' && !jobs.dismissed.includes(o.id) && !jobs.applied.includes(o.id) && !(jobs.deleted ?? []).includes(o.id) && (o.fit ?? 0) >= 25).length : 0
  const badge = (id: string) => (id === 'dashboard' ? dueCount : id === 'updates' ? unread : id === 'jobs' ? openJobs : 0)
  const moreActive = (MORE_ITEMS as readonly string[]).includes(view)

  const page =
    !data ? <DashboardSkeleton /> : view === 'dashboard' ? <Dashboard /> : view === 'exams' ? <Exams /> : view === 'jobs' ? <Jobs /> : view === 'calendar' ? <Calendar /> : view === 'updates' ? <Updates /> : view === 'documents' ? <Documents /> : <Settings />

  if (locked !== false) {
    return locked ? (
      <Lock
        onUnlocked={() => {
          setLocked(false)
          loadAll().then(setData)
        }}
      />
    ) : null
  }

  return (
    <AppCtx.Provider value={state}>
      <div className={`shell ${isPhone ? 'shell--phone' : ''}`}>
        {!isPhone ? (
          <aside className="rail">
            <a className="brand" href="#/dashboard" onClick={() => navigate('dashboard')}>
              <Logo size={34} interactive progress={ringProgress} pulse={examToday} />
              <span className="brand__name">Jenny's Tracker</span>
            </a>
            <button className="rail__search" onClick={() => setCmdOpen(true)} aria-label="Search and commands">
              <Icon name="list" size={15} />
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>
            <nav className="nav" aria-label="Main" ref={navRef}>
              <span className="nav__pill" style={{ transform: `translateY(${pillY}px)` }} aria-hidden="true" />
              {NAV.map((n) => (
                <a key={n.id} href={`#/${n.id}`} className={`nav__item ${view === n.id ? 'is-active' : ''}`} onClick={(e) => { e.preventDefault(); navigate(n.id) }}>
                  <Icon name={n.icon} />
                  <span>{n.label}</span>
                  {badge(n.id) ? <span className={`nav__badge ${n.id === 'updates' || n.id === 'jobs' ? 'nav__badge--sky' : ''}`}>{badge(n.id)}</span> : null}
                </a>
              ))}
            </nav>
            <div className="rail__foot">
              <button className="iconbtn" aria-label="Toggle theme" onClick={() => prefsStore.set({ ...prefs, theme: prefs.theme === 'ink' ? 'paper' : 'ink' })}>
                <Icon name={prefs.theme === 'ink' ? 'sun' : 'moon'} />
              </button>
              <button className="rail__date mono" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)}>{format(new Date(), 'EEE d MMM')}</button>
            </div>
          </aside>
        ) : (
          <header className="appbar">
            <span className="appbar__brand" onClick={() => navigate('dashboard')}>
              <Logo size={28} interactive progress={ringProgress} pulse={examToday} />
            </span>
            <span className="appbar__title">{TITLES[view]}</span>
            <button className="iconbtn appbar__search" aria-label="Search" onClick={() => setCmdOpen(true)}>
              <Icon name="list" size={18} />
            </button>
          </header>
        )}
        <main className={`main ${instant ? '' : pre}`} key={view}>
          {page}
        </main>
        {isPhone ? (
          <>
            <TabBar
              tabs={[...PHONE_TABS.map((id) => ({ id, label: TITLES[id], icon: NAV.find((n) => n.id === id)!.icon, badge: badge(id) })), { id: 'more', label: 'More', icon: 'list', badge: moreActive ? 0 : unread }]}
              active={moreActive ? 'more' : view}
              onSelect={(id) => (id === 'more' ? setMoreOpen(true) : navigate(id))}
            />
            <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
              <More
                items={MORE_ITEMS.map((id) => ({ id, label: TITLES[id], icon: NAV.find((n) => n.id === id)!.icon, badge: badge(id), hint: id === 'updates' ? 'Scraped notices' : id === 'documents' ? 'Forms and admit cards' : 'Reminders, profile, backup' }))}
                onSelect={(id) => navigate(id)}
              />
            </Sheet>
          </>
        ) : null}
        {data ? <Command open={cmdOpen} onClose={() => setCmdOpen(false)} navigate={navigate} /> : null}
        <Toasts />
        <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
          <ul className="keys">
            {[
              ['1 – 7', 'Desk, Exams, Jobs, Calendar, Updates, Documents, Settings'],
              ['⌘K / Ctrl K', 'Search pages, exams, openings and actions'],
              ['/', 'Search exams'],
              ['t', 'Toggle dark / light'],
              ['?', 'This list'],
              ['Esc', 'Close any sheet'],
            ].map(([k, v]) => (
              <li key={k}>
                <kbd>{k}</kbd>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Sheet>
        {update ? (
          <div className="toast toast--update" role="status">
            <span>New version available.</span>
            <button className="btn btn--accent btn--sm" onClick={() => { update.waiting?.postMessage('SKIP_WAITING'); setTimeout(() => location.reload(), 300) }}>
              Reload
            </button>
          </div>
        ) : null}
      </div>
    </AppCtx.Provider>
  )
}
