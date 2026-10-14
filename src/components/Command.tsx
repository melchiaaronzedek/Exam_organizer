import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { Icon } from './Icon'
import { prefsStore } from '../lib/storage'
import { buildICS, downloadText } from '../lib/ics'
import { useJobs } from '../lib/useJobs'
import { daysUntil, fmtShort, relative } from '../lib/dates'
import { nextPhase } from '../lib/data'

interface Item {
  id: string
  group: 'Pages' | 'Actions' | 'Exams' | 'Jobs'
  label: string
  hint?: string
  icon: string
  keywords?: string
  run: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  navigate: (view: string) => void
}

const PAGES: { id: string; label: string; icon: string; hint: string }[] = [
  { id: 'dashboard', label: 'Desk', icon: 'dashboard', hint: 'Today, countdown, what is due' },
  { id: 'exams', label: 'Exams', icon: 'exams', hint: 'Every phase, centre and checklist' },
  { id: 'jobs', label: 'Jobs', icon: 'list', hint: 'Openings that fit, fresher only' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', hint: 'Month view, agenda, travel plan' },
  { id: 'updates', label: 'Updates', icon: 'updates', hint: 'Scraped notices' },
  { id: 'documents', label: 'Documents', icon: 'documents', hint: 'Forms, admit cards, vault' },
  { id: 'settings', label: 'Settings', icon: 'settings', hint: 'Reminders, profile, backup' },
]

/** ⌘K palette: jump to any page, exam or opening, or run an action. */
export function Command({ open, onClose, navigate }: Props) {
  const { exams, events } = useApp()
  const { all, jobs } = useJobs()
  const prefs = prefsStore.use()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const items = useMemo<Item[]>(() => {
    const go = (view: string, after?: () => void) => () => {
      onClose()
      navigate(view)
      if (after) setTimeout(after, 120)
    }
    const pages: Item[] = PAGES.map((p) => ({ id: `page-${p.id}`, group: 'Pages', label: p.label, hint: p.hint, icon: p.icon, run: go(p.id) }))
    const actions: Item[] = [
      { id: 'theme', group: 'Actions', label: prefs.theme === 'ink' ? 'Switch to light theme' : 'Switch to dark theme', icon: prefs.theme === 'ink' ? 'sun' : 'moon', keywords: 'theme dark light paper ink', run: () => { prefsStore.set((p) => ({ ...p, theme: p.theme === 'ink' ? 'paper' : 'ink' })); onClose() } },
      { id: 'ics', group: 'Actions', label: 'Export calendar (.ics)', hint: 'All exam dates with alarms', icon: 'download', keywords: 'ical google calendar export', run: () => { downloadText('jenny-tracker.ics', buildICS(events, prefs.leadDays)); onClose() } },
      { id: 'add', group: 'Actions', label: 'Add an exam', icon: 'plus', keywords: 'new custom exam', run: go('exams', () => document.getElementById('add-exam')?.scrollIntoView({ behavior: 'smooth' })) },
      { id: 'search-jobs', group: 'Actions', label: 'Search jobs', icon: 'list', keywords: 'find opening', run: go('jobs', () => document.getElementById('job-search')?.focus()) },
      { id: 'print', group: 'Actions', label: 'Print this page', icon: 'file', run: () => { onClose(); setTimeout(() => window.print(), 150) } },
    ]
    const ex: Item[] = exams.map((e) => {
      const np = nextPhase(e)
      const d = np?.date ? daysUntil(np.date) : null
      return {
        id: `exam-${e.id}`, group: 'Exams', label: `${e.short} · ${e.post}`, icon: 'exams', keywords: `${e.org} ${e.title}`,
        hint: np?.date ? `${np.name} · ${fmtShort(np.date)} · ${relative(d)}` : e.status.replace('-', ' '),
        run: go('exams', () => document.getElementById(`exam-${e.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })),
      }
    })
    const jb: Item[] = all
      .filter((o) => o.status === 'open' && !jobs.dismissed.includes(o.id) && !(jobs.deleted ?? []).includes(o.id) && (o.fit ?? 0) >= 25 && o.expOk)
      .slice(0, 400)
      .map((o) => ({
        id: `job-${o.id}`, group: 'Jobs', label: `${o.org} · ${o.post}`, icon: 'list', keywords: `${o.locations?.join(' ') ?? ''} ${o.source ?? ''}`,
        hint: [o.pay, o.applyCloses ? `closes ${fmtShort(o.applyCloses)}` : null, o.locations?.slice(0, 2).join(', ')].filter(Boolean).join(' · '),
        run: go('jobs', () => window.dispatchEvent(new CustomEvent('jt:focus-job', { detail: { id: o.id } }))),
      }))
    return [...pages, ...actions, ...ex, ...jb]
  }, [exams, events, all, jobs, prefs, navigate, onClose])

  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return items.filter((i) => i.group !== 'Jobs').slice(0, 24)
    const words = t.split(/\s+/)
    const scored = items
      .map((i) => {
        const hay = `${i.label} ${i.hint ?? ''} ${i.keywords ?? ''}`.toLowerCase()
        if (!words.every((w) => hay.includes(w))) return null
        const s = (i.label.toLowerCase().startsWith(t) ? 3 : 0) + (i.label.toLowerCase().includes(t) ? 2 : 0) + (i.group === 'Pages' ? 1 : 0)
        return { i, s }
      })
      .filter((x): x is { i: Item; s: number } => !!x)
      .sort((a, b) => b.s - a.s)
    return scored.slice(0, 40).map((x) => x.i)
  }, [items, q])

  useEffect(() => {
    if (!open) return
    setQ('')
    setIdx(0)
    const t = setTimeout(() => input.current?.focus(), 30)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [open])
  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  if (!open) return null
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); results[idx]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }
  let lastGroup = ''
  return (
    <div className="cmd" role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose}>
      <div className="cmd__panel" onClick={(e) => e.stopPropagation()}>
        <label className="cmd__input">
          <Icon name="list" size={16} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Jump to a page, exam or opening… or type an action" aria-label="Search" autoComplete="off" spellCheck={false} />
          <kbd>esc</kbd>
        </label>
        <ul className="cmd__list" ref={list} role="listbox">
          {results.length === 0 ? <li className="cmd__empty muted">No matches.</li> : null}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? r.group : null
            lastGroup = r.group
            return (
              <li key={r.id}>
                {head ? <div className="cmd__group">{head}</div> : null}
                <button data-i={i} className={`cmd__item ${i === idx ? 'is-active' : ''}`} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => r.run()}>
                  <Icon name={r.icon} size={16} />
                  <span className="cmd__label">{r.label}</span>
                  {r.hint ? <span className="cmd__hint muted">{r.hint}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="cmd__foot muted small">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>1</kbd>–<kbd>7</kbd> pages</span>
          <span><kbd>t</kbd> theme</span>
        </div>
      </div>
    </div>
  )
}
