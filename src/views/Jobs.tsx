import { useMemo, useState } from 'react'
import { useApp } from '../ctx'
import { Icon } from '../components/Icon'
import { useEntrance } from '../lib/useEntrance'
import { fitScore, isSouth } from '../lib/fit'
import { jobsStore, profileStore } from '../lib/storage'
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
  const [tab, setTab] = useState<'open' | 'expected' | 'closed' | 'dismissed'>('open')
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
    .filter((o) => (tab === 'dismissed' ? jobs.dismissed.includes(o.id) : !jobs.dismissed.includes(o.id) && o.status === tab))
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

  const counts = {
    open: all.filter((o) => o.status === 'open' && !jobs.dismissed.includes(o.id)).length,
    expected: all.filter((o) => o.status === 'expected' && !jobs.dismissed.includes(o.id)).length,
    closed: all.filter((o) => o.status === 'closed' && !jobs.dismissed.includes(o.id)).length,
    dismissed: jobs.dismissed.length,
  }

  const track_ = (o: Opportunity) => {
    const id = `custom-${o.id}`
    if (!exams.some((e) => e.id === id)) {
      const ex: Exam = {
        id,
        org: o.org,
        short: o.org.length > 14 ? o.org.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 8) : o.org,
        title: `${o.org} — ${o.post}`,
        post: o.post,
        status: 'to-apply',
        officialUrl: o.link,
        applyUrl: o.link,
        application: { opens: o.applyOpens ?? undefined, closes: o.applyCloses ?? undefined, applied: false, note: o.eligibility || undefined },
        phases: [
          ...(o.applyCloses ? [{ id: 'apply', name: 'Application window', kind: 'application' as const, date: o.applyOpens ?? o.applyCloses, dateEnd: o.applyCloses, dateType: 'confirmed' as const, status: 'upcoming' as const }] : []),
          { id: 'exam', name: 'Exam / selection', kind: 'exam' as const, date: o.examDate ?? undefined, dateType: o.examDate ? o.examDateType ?? 'tentative' : 'tba', status: o.examDate ? 'upcoming' : 'tba', centre: { preferences: [], allotted: null } },
          { id: 'interview', name: 'Interview', kind: 'interview' as const, dateType: 'tba' as const, status: 'tba' as const },
        ],
        facts: { vacancies: o.vacancies ? String(o.vacancies) : undefined, age: o.ageMax ? `≤ ${o.ageMax}` : undefined, pay: o.pay ?? undefined },
        notes: [o.source ? `Source: ${o.source} (${o.sourceType})` : ''].filter(Boolean),
        custom: true,
      }
      addCustomExam(ex)
    }
    jobsStore.set((s) => ({ ...s, tracked: { ...s.tracked, [o.id]: id } }))
  }
  const dismiss = (o: Opportunity) => jobsStore.set((s) => ({ ...s, dismissed: s.dismissed.includes(o.id) ? s.dismissed.filter((x) => x !== o.id) : [...s.dismissed, o.id] }))

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
          {(['open', 'expected', 'closed', 'dismissed'] as const).map((t) => (
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
              <li key={o.id} className={`job ${isOpen ? 'is-open' : ''}`} style={{ ['--i' as string]: Math.min(i, 10) }}>
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
                    {tracked ? <span className="src src--tracked">tracking</span> : null}
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
                    <div className="row">
                      <a className="btn btn--accent btn--sm" href={o.link} target="_blank" rel="noreferrer">
                        <Icon name="external" size={14} /> {o.status === 'expected' ? 'Official site' : 'Open listing'}
                      </a>
                      {tracked ? (
                        <button className="btn btn--sm" onClick={() => { navigate('exams'); setTimeout(() => document.getElementById(`exam-${tracked}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80) }}>
                          <Icon name="check" size={14} /> In Exams
                        </button>
                      ) : (
                        <button className="btn btn--sm" onClick={() => track_(o)}>
                          <Icon name="plus" size={14} /> Track
                        </button>
                      )}
                      <button className="btn btn--ghost btn--sm" onClick={() => dismiss(o)}>
                        <Icon name={jobs.dismissed.includes(o.id) ? 'refresh' : 'x'} size={14} /> {jobs.dismissed.includes(o.id) ? 'Restore' : 'Dismiss'}
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
