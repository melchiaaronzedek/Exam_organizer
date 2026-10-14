import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AppCtx, type AppState } from './ctx'
import type { DocumentsFile, Exam, ExamOverride, ExamsFile, PhaseOverride, ScrapeStatusFile, UpdatesFile } from './types'
import { buildEvents, isFresh, loadAll, mergeExam } from './lib/data'
import { customExamsStore, overridesStore, prefsStore, seenStore } from './lib/storage'
import { listDocs } from './lib/vault'
import { maybeNotify, dueEvents } from './lib/notify'
import { Icon } from './components/Icon'
import { DashboardSkeleton } from './components/Skeleton'
import { useEntrance } from './lib/useEntrance'
import { Dashboard } from './views/Dashboard'
import { Exams } from './views/Exams'
import { Calendar } from './views/Calendar'
import { Updates } from './views/Updates'
import { Documents } from './views/Documents'
import { Settings } from './views/Settings'
import { format } from 'date-fns'

const NAV = [
  { id: 'dashboard', label: 'Desk', icon: 'dashboard' },
  { id: 'exams', label: 'Exams', icon: 'exams' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'updates', label: 'Updates', icon: 'updates' },
  { id: 'documents', label: 'Documents', icon: 'documents' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const

function readHash() {
  const h = location.hash.replace(/^#\/?/, '')
  return NAV.some((n) => n.id === h) ? h : 'dashboard'
}

export function App() {
  const [view, setView] = useState(readHash)
  const [instant, setInstant] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const [pillY, setPillY] = useState(0)
  const pre = useEntrance([view])
  const [data, setData] = useState<{ exams: ExamsFile; updates: UpdatesFile; status: ScrapeStatusFile; documents: DocumentsFile } | null>(null)
  const [docCounts, setDocCounts] = useState<Record<string, number>>({})
  const overrides = overridesStore.use()
  const custom = customExamsStore.use()
  const prefs = prefsStore.use()
  const seen = seenStore.use()

  useEffect(() => {
    loadAll().then(setData)
    const onHash = () => setView(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', prefs.theme === 'ink' ? '#0b0d12' : '#f3eee3')
  }, [prefs.theme])

  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('.nav__item.is-active')
    if (el) setPillY(el.offsetTop)
  }, [view])

  // Keyboard shortcuts: 1-6 switch views, / focuses search, t toggles theme.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
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
  }, [])

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

  const navigate = useCallback((v: string, viaKeyboard = false) => {
    setInstant(viaKeyboard)
    location.hash = `/${v}`
    setView(v)
    window.scrollTo({ top: 0, behavior: viaKeyboard ? 'auto' : 'smooth' })
  }, [])

  const state: AppState = {
    exams,
    events,
    updates: data?.updates ?? { updatedAt: null, updates: [] },
    status: data?.status ?? { lastRun: null, sources: [] },
    documents: data?.documents.documents ?? [],
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
  const unread = (data?.updates.updates ?? []).filter((u) => isFresh(u) && !seen.ids.includes(u.id)).length

  return (
    <AppCtx.Provider value={state}>
      <div className="shell">
        <aside className="rail">
          <a className="brand" href="#/dashboard" onClick={() => navigate('dashboard')}>
            <span className="brand__mark" aria-hidden="true" />
            <span className="brand__text">
              <span className="brand__name">Pariksha Desk</span>
              <span className="brand__tag">exam command centre</span>
            </span>
          </a>
          <nav className="nav" aria-label="Main" ref={navRef}>
            <span className="nav__pill" style={{ transform: `translateY(${pillY}px)` }} aria-hidden="true" />
            {NAV.map((n) => (
              <a key={n.id} href={`#/${n.id}`} className={`nav__item ${view === n.id ? 'is-active' : ''}`} onClick={(e) => { e.preventDefault(); navigate(n.id) }}>
                <Icon name={n.icon} />
                <span>{n.label}</span>
                {n.id === 'dashboard' && dueCount ? <span className="nav__badge">{dueCount}</span> : null}
                {n.id === 'updates' && unread ? <span className="nav__badge nav__badge--sky">{unread}</span> : null}
              </a>
            ))}
          </nav>
          <div className="rail__foot">
            <button className="iconbtn" aria-label="Toggle theme" onClick={() => prefsStore.set({ ...prefs, theme: prefs.theme === 'ink' ? 'paper' : 'ink' })}>
              <Icon name={prefs.theme === 'ink' ? 'sun' : 'moon'} />
            </button>
            <span className="rail__date mono" title="Shortcuts: 1-6 views · / search · t theme">{format(new Date(), 'EEE d MMM')}</span>
          </div>
        </aside>
        <main className={`main ${instant ? '' : pre}`} key={view}>
          {!data ? (
            <DashboardSkeleton />
          ) : view === 'dashboard' ? (
            <Dashboard />
          ) : view === 'exams' ? (
            <Exams />
          ) : view === 'calendar' ? (
            <Calendar />
          ) : view === 'updates' ? (
            <Updates />
          ) : view === 'documents' ? (
            <Documents />
          ) : (
            <Settings />
          )}
        </main>
      </div>
    </AppCtx.Provider>
  )
}
