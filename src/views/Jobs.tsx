import { useMemo, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { Icon } from '../components/Icon'
import { useEntrance } from '../lib/useEntrance'
import { fitScore, isSouth } from '../lib/fit'
import { jobsStore, profileStore } from '../lib/storage'
import { isoToday } from '../lib/dates'
import { daysUntil, fmtShort, relative } from '../lib/dates'
import type { Exam, Opportunity, OppTrack } from '../types'

const TRACKS: { id: OppTrack | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'marketing', label: 'Marketing · MT' },
  { id: 'general', label: 'AO · PO · Grade A' },
  { id: 'agri', label: 'Agriculture' },
  { id: 'state', label: 'State' },
  { id: 'private', label: 'Private · NBFC' },
]

export function Jobs() {
  const { opportunities, profile, exams, addCustomExam, navigate } = useApp()
  const jobs = jobsStore.use()
  const po = profileStore.use()
  const pre = useEntrance([])
  const [track, setTrack] = useState<OppTrack | 'all'>('all')
  const [tab, setTab] = useState<'open' | 'expected' | 'applied' | 'closed' | 'dismissed'>('open')
  const swipe = useRef<{ id: string; x: number; dx: number } | null>(null)
  const [sort, setSort] = useState<'deadline' | 'fit' | 'pay'>('deadline')
  const [showLow, setShowLow] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const southFirst = po.southFirst ?? true
  const prof = { ...profile, roles: po.roles ?? profile.roles, cities: po.cities ?? profile.cities, minPayLakh: po.minPayLakh ?? profile.minPayLakh }

  const all = useMemo(() => {
    const list = [...opportunities.curated, ...opportunities.discovered].map((o) => {
      const f = fitScore(o, prof)
      const closes = o.applyCloses ?? null
      const d = closes ? daysUntil(closes) : null
      let status = o.status
      if (status === 'open' && d != null && d < 0) status = 'closed'
      return { ...o, fit: o.curated ? Math.max(o.fit ?? 0, f.score) : f.score, fitWhy: o.fitWhy?.length ? o.fitWhy : f.why, status, days: d, south: isSouth(o) }
    })
    return list
  }, [opportunities, prof])

  const shown = all
    .filter((o) => !(jobs.deleted ?? []).includes(o.id))
    .filter((o) => (tab === 'dismissed' ? jobs.dismissed.includes(o.id) : tab === 'applied' ? jobs.applied.includes(o.id) : !jobs.dismissed.includes(o.id) && !jobs.applied.includes(o.id) && o.status === tab))
    .filter((o) => track === 'all' || o.track === track)
    .filter((o) => showLow || (o.fit ?? 0) >= 25)
    .sort((a, b) => {
      if (southFirst && a.south !== b.south) return a.south ? -1 : 1
      if (sort === 'fit') return (b.fit ?? 0) - (a.fit ?? 0)
      if (sort === 'pay') return (b.payLakh ?? 0) - (a.payLakh ?? 0)
      const ad = a.days ?? (a.expectedMonth ? 9999 : 99999)
      const bd = b.days ?? (b.expectedMonth ? 9999 : 99999)
      if (tab === 'expected') return (a.expectedMonth ?? '9999').localeCompare(b.expectedMonth ?? '9999')
      return ad - bd
    })

  const hidden = (o: Opportunity) => jobs.dismissed.includes(o.id) || jobs.applied.includes(o.id) || (jobs.deleted ?? []).includes(o.id)
  const counts = {
    open: all.filter((o) => o.status === 'open' && !hidden(o)).length,
    expected: all.filter((o) => o.status === 'expected' && !hidden(o)).length,
    applied: jobs.applied.length,
    closed: all.filter((o) => o.status === 'closed' && !hidden(o)).length,
    dismissed: jobs.dismissed.length,
  }

  const toExam = (o: Opportunity, status: Exam['status']): Exam => ({
    id: `custom-${o.id}`,
    org: o.org,
    short: o.org.length > 14 ? o.org.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 8) : o.org,
    title: `${o.org} — ${o.post}`,
    post: o.post,
    status,
    officialUrl: o.link,
    applyUrl: o.link,
    application: { opens: o.applyOpens ?? undefined, closes: o.applyCloses ?? undefined, applied: status !== 'to-apply', appliedOn: status === 'applied' ? isoToday() : undefined, note: o.eligibility || undefined },
    phases: [
      ...(o.applyCloses ? [{ id: 'apply', name: 'Application window', kind: 'application' as const, date: o.applyOpens ?? o.applyCloses, dateEnd: o.applyCloses, dateType: 'confirmed' as const, status: (status === 'to-apply' ? 'upcoming' : 'done') as 'upcoming' | 'done' }] : []),
      { id: 'exam', name: 'Exam / selection', kind: 'exam' as const, date: o.examDate ?? undefined, dateType: o.examDate ? o.examDateType ?? 'tentative' : 'tba', status: o.examDate ? 'upcoming' : 'tba', centre: { preferences: [], allotted: null } },
      { id: 'interview', name: 'Interview', kind: 'interview' as const, dateType: 'tba' as const, status: 'tba' as const },
    ],
    facts: { vacancies: o.vacancies ? String(o.vacancies) : undefined, age: o.ageMax ? `≤ ${o.ageMax}` : undefined, pay: o.pay ?? undefined },
    notes: [o.source ? `Source: ${o.source} (${o.sourceType})` : ''].filter(Boolean),
    custom: true,
  })
  const ensureTracked = (o: Opportunity, status: Exam['status']) => {
    const ex = toExam(o, status)
    if (!exams.some((e) => e.id === ex.id)) addCustomExam(ex)
    jobsStore.set((s) => ({ ...s, tracked: { ...s.tracked, [o.id]: ex.id } }))
    return ex
  }
  const track_ = (o: Opportunity) => ensureTracked(o, 'to-apply')
  const markApplied = (o: Opportunity) => {
    ensureTracked(o, 'applied')
    jobsStore.set((s) => ({ ...s, applied: s.applied.includes(o.id) ? s.applied : [...s.applied, o.id], dismissed: s.dismissed.filter((x) => x !== o.id) }))
  }
  const dontWant = (o: Opportunity) => jobsStore.set((s) => ({ ...s, dismissed: s.dismissed.includes(o.id) ? s.dismissed : [...s.dismissed, o.id], applied: s.applied.filter((x) => x !== o.id) }))
  const del = (o: Opportunity) => jobsStore.set((s) => ({ ...s, deleted: [...(s.deleted ?? []), o.id], dismissed: s.dismissed.filter((x) => x !== o.id), applied: s.applied.filter((x) => x !== o.id) }))
  const remind = (o: Opportunity) => {
    const ex = ensureTracked(o, 'to-apply')
    jobsStore.set((s) => ({ ...s, reminded: s.reminded.includes(o.id) ? s.reminded : [...s.reminded, o.id] }))
    const body = `Track this opening so email / Telegram / WhatsApp reminders cover it. The daily job reads the JSON below, adds it to exams.json and closes this issue.\n\n\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\``
    const url = `https://github.com/melchiaaronzedek/Exam_organizer/issues/new?labels=track&title=${encodeURIComponent(`Track: ${o.org} — ${o.post}`.slice(0, 200))}&body=${encodeURIComponent(body)}`
    window.open(url, '_blank', 'noopener')
  }
  const restore = (o: Opportunity) => jobsStore.set((s) => ({ ...s, dismissed: s.dismissed.filter((x) => x !== o.id), applied: s.applied.filter((x) => x !== o.id) }))

  return (
    <div className="view">
      <header className="view__head">
        <div>
          <h1 className="view__title">Jobs</h1>
          <p className="muted">{profile.headline}. Matched to: {prof.roles.slice(0, 5).join(' · ')}.</p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('settings')}>
          <Icon name="settings" size={14} /> Edit profile
        </button>
      </header>

      <div className="toolbar">
        <div className="seg">
          {(['open', 'expected', 'applied', 'closed', 'dismissed'] as const).map((t) => (
            <button key={t} className={`seg__btn ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)} <span className="seg__n">{counts[t]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <div className="filters filters--rail">
          {TRACKS.map((t) => (
            <button key={t.id} className={`filter ${track === t.id ? 'is-active' : ''}`} onClick={() => setTrack(t.id)}>
              {t.label}
            </button>
          ))}
          <span className="filters__sep" />
          <label className="filter filter--toggle">
            <input type="checkbox" checked={southFirst} onChange={(e) => profileStore.set({ ...po, southFirst: e.target.checked })} /> South first
          </label>
          <label className="filter filter--toggle">
            <input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} /> Show low fit
          </label>
          <select className="filter" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
            <option value="deadline">By deadline</option>
            <option value="fit">By fit</option>
            <option value="pay">By pay</option>
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <Icon name="list" size={28} />
          <p>{tab === 'open' ? 'No open postings match. The daily job adds new ones each morning.' : tab === 'expected' ? 'Nothing expected in this track yet.' : 'Nothing here.'}</p>
        </div>
      ) : (
        <ul className={`jobs ${pre}`}>
          {shown.map((o, i) => {
            const tracked = jobs.tracked[o.id] ?? (o.trackedExamId && exams.some((e) => e.id === o.trackedExamId) ? o.trackedExamId : undefined)
            const isOpen = expanded === o.id
            return (
              <li
                key={o.id}
                className={`job ${isOpen ? 'is-open' : ''} ${jobs.applied.includes(o.id) ? 'is-applied' : ''}`}
                style={{ ['--i' as string]: Math.min(i, 10) }}
                onTouchStart={(e) => { swipe.current = { id: o.id, x: e.touches[0].clientX, dx: 0 } }}
                onTouchMove={(e) => {
                  if (!swipe.current || swipe.current.id !== o.id) return
                  swipe.current.dx = e.touches[0].clientX - swipe.current.x
                  const el = e.currentTarget as HTMLElement
                  el.style.transform = `translateX(${Math.max(-140, Math.min(140, swipe.current.dx))}px)`
                  el.style.transition = 'none'
                  el.dataset.swipe = swipe.current.dx > 40 ? 'right' : swipe.current.dx < -40 ? 'left' : ''
                }}
                onTouchEnd={(e) => {
                  const el = e.currentTarget as HTMLElement
                  const dx = swipe.current?.dx ?? 0
                  el.style.transition = ''
                  el.style.transform = ''
                  el.dataset.swipe = ''
                  swipe.current = null
                  if (dx > 110) markApplied(o)
                  else if (dx < -110) dontWant(o)
                }}
              >
                <span className="job__hint job__hint--right" aria-hidden="true">Applied</span>
                <span className="job__hint job__hint--left" aria-hidden="true">Don't want</span>
                <button className="job__main" onClick={() => setExpanded(isOpen ? null : o.id)} aria-expanded={isOpen}>
                  <span className="job__top">
                    <span className="job__org">{o.org}</span>
                    <span className={`fit fit--${(o.fit ?? 0) >= 70 ? 'high' : (o.fit ?? 0) >= 45 ? 'mid' : 'low'}`} title={(o.fitWhy ?? []).join(', ')}>
                      {o.fit}
                    </span>
                  </span>
                  <span className="job__post">{o.post}</span>
                  <span className="job__meta">
                    {o.status === 'open' && o.applyCloses ? (
                      <span className={`job__due ${o.days != null && o.days <= 5 ? 'is-urgent' : ''}`}>
                        <Icon name="clock" size={12} /> closes {fmtShort(o.applyCloses)} · {relative(o.days ?? null)}
                      </span>
                    ) : o.status === 'open' ? (
                      <span className="job__due muted">
                        <Icon name="clock" size={12} /> deadline not stated
                      </span>
                    ) : o.status === 'expected' ? (
                      <span className="job__due">
                        <Icon name="calendar" size={12} /> expected {o.typicalWindow ?? o.expectedMonth ?? 'soon'}
                      </span>
                    ) : (
                      <span className="job__due muted">closed {o.applyCloses ? fmtShort(o.applyCloses) : ''}</span>
                    )}
                    {o.pay ? <span className="muted">· {o.pay}</span> : null}
                    {o.locations?.length ? (
                      <span className="muted">
                        · <Icon name="pin" size={11} /> {o.locations.slice(0, 3).join(', ')}
                        {o.locations.length > 3 ? ` +${o.locations.length - 3}` : ''}
                      </span>
                    ) : null}
                  </span>
                  <span className="job__tags">
                    <span className={`src src--${o.sourceType}`}>{o.sourceType}</span>
                    {jobs.applied.includes(o.id) ? <span className="src src--applied">applied</span> : tracked ? <span className="src src--tracked">tracking</span> : null}
                    {jobs.reminded.includes(o.id) ? <span className="src src--tracked">reminder</span> : null}
                    {o.track ? <span className="src">{TRACKS.find((t) => t.id === o.track)?.label ?? o.track}</span> : null}
                  </span>
                </button>
                <div className={`job__expand ${isOpen ? 'is-open' : ''}`}>
                  <div className="job__expand-inner">
                    <dl className="qf">
                      {o.eligibility ? <Row k="Eligibility" v={o.eligibility} /> : null}
                      {o.ageMax ? <Row k="Age" v={`≤ ${o.ageMax}` + (o.ageMax ? ' (SC relaxation usually +5)' : '')} /> : null}
                      {o.vacancies ? <Row k="Vacancies" v={String(o.vacancies)} /> : null}
                      {o.applyOpens || o.applyCloses ? <Row k="Apply" v={`${o.applyOpens ? fmtShort(o.applyOpens) : '—'} → ${o.applyCloses ? fmtShort(o.applyCloses) : '—'}`} /> : null}
                      {o.examDate ? <Row k="Exam" v={`${fmtShort(o.examDate)}${o.examDateType === 'tentative' ? ' (tentative)' : ''}`} /> : null}
                      {o.lastCycle ? <Row k="Last cycle" v={o.lastCycle} /> : null}
                      {o.note ? <Row k="Note" v={o.note} /> : null}
                      <Row k="Why it fits" v={(o.fitWhy ?? []).join(' · ') || '—'} />
                      <Row k="Source" v={`${o.source ?? o.sourceType}${o.sourceType !== 'official' ? ' — verify on the official site before paying any fee' : ''}`} />
                    </dl>
                    <div className="job__actions">
                      <a className="btn btn--accent btn--sm" href={o.link} target="_blank" rel="noreferrer">
                        <Icon name="external" size={14} /> {o.status === 'expected' ? 'Official site' : 'Open listing'}
                      </a>
                      {tab === 'dismissed' || tab === 'applied' ? (
                        <button className="btn btn--sm" onClick={() => restore(o)}>
                          <Icon name="refresh" size={14} /> Restore
                        </button>
                      ) : null}
                      {!jobs.applied.includes(o.id) ? (
                        <button className="btn btn--sm" onClick={() => markApplied(o)}>
                          <Icon name="check" size={14} /> Applied
                        </button>
                      ) : null}
                      <button className="btn btn--sm" onClick={() => remind(o)} title="Adds it to Exams and opens a GitHub issue so email / Telegram / WhatsApp reminders cover it">
                        <Icon name="bell" size={14} /> {jobs.reminded.includes(o.id) ? 'Remind again' : 'Remind'}
                      </button>
                      {tracked ? (
                        <button className="btn btn--ghost btn--sm" onClick={() => { navigate('exams'); setTimeout(() => document.getElementById(`exam-${tracked}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80) }}>
                          <Icon name="exams" size={14} /> In Exams
                        </button>
                      ) : (
                        <button className="btn btn--ghost btn--sm" onClick={() => track_(o)}>
                          <Icon name="plus" size={14} /> Track
                        </button>
                      )}
                      {!jobs.dismissed.includes(o.id) ? (
                        <button className="btn btn--ghost btn--sm" onClick={() => dontWant(o)}>
                          <Icon name="x" size={14} /> Don't want
                        </button>
                      ) : null}
                      <button className="btn btn--ghost btn--sm btn--danger" onClick={() => del(o)}>
                        <Icon name="trash" size={14} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="muted small">
        On a phone, swipe a row right to mark it applied or left to say you don't want it. Remind adds the opening to Exams and opens a prefilled GitHub issue; submit it and the morning job adds it to the shared data so email, Telegram and WhatsApp reminders cover it.
        Curated {opportunities.curatedAt ? `on ${fmtShort(opportunities.curatedAt)}` : 'from research'}; discovered items refresh daily
        {opportunities.discoveredAt ? ` (last ${fmtShort(opportunities.discoveredAt)})` : ''}. Fit is a keyword score, not eligibility advice.
      </p>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}
