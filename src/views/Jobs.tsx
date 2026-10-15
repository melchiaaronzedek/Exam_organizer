import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { Icon } from '../components/Icon'
import { useEntrance } from '../lib/useEntrance'
import { markJobsVisited, useJobs, type JobItem } from '../lib/useJobs'
import { profileStore } from '../lib/storage'
import { fmtShort, relative } from '../lib/dates'
import { experienceLabel } from '../lib/fit'
import { plainText } from '../lib/text'
import type { OppTrack } from '../types'

const TRACKS: { id: OppTrack | 'all'; label: string }[] = [
  { id: 'all', label: 'All tracks' },
  { id: 'marketing', label: 'Marketing · MT' },
  { id: 'general', label: 'AO · PO · Grade A' },
  { id: 'agri', label: 'Agriculture' },
  { id: 'state', label: 'State' },
  { id: 'private', label: 'Private · NBFC' },
]
type Tab = 'open' | 'expected' | 'applied' | 'closed' | 'dismissed'
type Scope = 'all' | 'govt' | 'private'

export function Jobs() {
  const { opportunities, navigate } = useApp()
  const J = useJobs()
  const { all, jobs, prof, hidden } = J
  const pre = useEntrance([])
  const [scope, setScope] = useState<Scope>('all')
  const [track, setTrack] = useState<OppTrack | 'all'>('all')
  const [tab, setTab] = useState<Tab>('open')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'deadline' | 'fit' | 'pay' | 'new'>('deadline')
  const [showHidden, setShowHidden] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [onlyNew, setOnlyNew] = useState(false)
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [source, setSource] = useState<string>('all')
  const po = profileStore.use()
  const southFirst = po.southFirst ?? true
  const swipe = useRef<{ id: string; x: number; dx: number } | null>(null)

  // Remember this visit so the next one can mark what is new.
  useEffect(() => () => markJobsVisited(), [])
  // Command palette / dashboard can ask for a row to be opened.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (!id) return
      const o = all.find((x) => x.id === id)
      if (!o) return
      setTab(jobs.applied.includes(id) ? 'applied' : jobs.dismissed.includes(id) ? 'dismissed' : o.status === 'expected' ? 'expected' : o.status === 'closed' ? 'closed' : 'open')
      setScope('all')
      setTrack('all')
      setSource('all')
      setQ('')
      setShowHidden(true)
      setExpanded(id)
      setTimeout(() => document.getElementById(`job-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    }
    window.addEventListener('jt:focus-job', onFocus)
    return () => window.removeEventListener('jt:focus-job', onFocus)
  }, [all, jobs])

  const visible = (o: JobItem) => showHidden || ((o.fit ?? 0) >= 25 && o.expOk)
  const matchesQuery = (o: JobItem) => {
    if (!q.trim()) return true
    const hay = `${o.org} ${o.post} ${o.locations?.join(' ') ?? ''} ${o.source ?? ''} ${o.sector}`.toLowerCase()
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))
  }
  const inScope = (o: JobItem) => scope === 'all' || (scope === 'private' ? o.private : !o.private)

  const pool = all.filter((o) => !(jobs.deleted ?? []).includes(o.id))
  const shown = pool
    .filter((o) => (tab === 'dismissed' ? jobs.dismissed.includes(o.id) : tab === 'applied' ? jobs.applied.includes(o.id) : !jobs.dismissed.includes(o.id) && !jobs.applied.includes(o.id) && o.status === tab))
    .filter(inScope)
    .filter((o) => track === 'all' || o.track === track)
    .filter((o) => !onlyNew || o.isNew)
    .filter((o) => !verifiedOnly || !o.private || o.trust === 'verified')
    .filter((o) => source === 'all' || o.source === source)
    .filter(visible)
    .filter(matchesQuery)
    .sort((a, b) => {
      if (southFirst && a.south !== b.south) return a.south ? -1 : 1
      if (sort === 'fit') return (b.fit ?? 0) - (a.fit ?? 0)
      if (sort === 'pay') return (b.payMinLakh ?? b.payLakh ?? 0) - (a.payMinLakh ?? a.payLakh ?? 0)
      if (sort === 'new') return (b.firstSeen ?? b.postedAt ?? '').localeCompare(a.firstSeen ?? a.postedAt ?? '')
      if (tab === 'expected') return (a.expectedMonth ?? '9999').localeCompare(b.expectedMonth ?? '9999')
      const ad = a.days ?? 99999
      const bd = b.days ?? 99999
      if (ad !== bd) return ad - bd
      return (b.postedAt ?? b.firstSeen ?? '').localeCompare(a.postedAt ?? a.firstSeen ?? '')
    })

  const openPool = pool.filter((o) => o.status === 'open' && !hidden(o) && visible(o))
  const counts = {
    open: openPool.length,
    expected: pool.filter((o) => o.status === 'expected' && !hidden(o) && visible(o)).length,
    applied: jobs.applied.length,
    closed: pool.filter((o) => o.status === 'closed' && !hidden(o)).length,
    dismissed: jobs.dismissed.length,
  }
  const stats = {
    urgent: openPool.filter((o) => o.days != null && o.days <= 7).length,
    private: openPool.filter((o) => o.private).length,
    isNew: openPool.filter((o) => o.isNew).length,
    govt: openPool.filter((o) => !o.private).length,
  }

  const groups = useMemo(() => {
    if (tab !== 'open' || sort !== 'deadline') return [{ id: 'all', title: null as string | null, items: shown }]
    const g = [
      { id: 'urgent', title: 'Closing within 7 days', items: shown.filter((o) => o.days != null && o.days <= 7) },
      { id: 'dated', title: 'Open, with a deadline', items: shown.filter((o) => o.days != null && o.days > 7) },
      { id: 'posted', title: 'Recently posted, no deadline stated', items: shown.filter((o) => o.days == null) },
    ]
    return g.filter((x) => x.items.length)
  }, [shown, tab, sort])

  const portalStatus = opportunities.portalStatus ?? []
  const portalRan = portalStatus.filter((s) => s.state !== 'off')
  const portalOk = portalRan.filter((s) => s.ok)
  const sources = useMemo(() => {
    const n = new Map<string, number>()
    for (const o of pool) if (o.sourceType === 'portal' && o.source && !hidden(o) && visible(o)) n.set(o.source, (n.get(o.source) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, jobs, showHidden])
  const statusLabel = (s: (typeof portalStatus)[number]) =>
    s.state === 'off' ? `${s.name} – off` : s.ok ? `${s.name} ✓ ${s.scanned ?? s.fetched ?? 0}${s.state === 'partial' ? '*' : ''}` : `${s.name} ✗ ${s.reason ?? 'failed'}`

  return (
    <div className="view">
      <header className="view__head">
        <div>
          <h1 className="view__title">Jobs</h1>
          <p className="muted">
            Fresher-only ({`≤ ${(prof.maxExperienceYears ?? 0.5) * 12} months`} experience). Private roles only when the listed pay reaches ₹{prof.privateMinPayLakh} LPA. Matched to {prof.roles.slice(0, 4).join(' · ')}.
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('settings')}>
          <Icon name="settings" size={14} /> Edit profile
        </button>
      </header>

      <div className="stats" role="group" aria-label="Summary">
        <button className={`stat ${tab === 'open' && scope === 'all' && !onlyNew ? 'is-active' : ''}`} onClick={() => { setTab('open'); setScope('all'); setOnlyNew(false) }}>
          <span className="stat__n mono">{counts.open}</span>
          <span className="stat__l">Open now</span>
        </button>
        <button className={`stat stat--rose ${sort === 'deadline' && tab === 'open' && stats.urgent ? '' : ''}`} onClick={() => { setTab('open'); setSort('deadline'); setScope('all'); setOnlyNew(false); document.getElementById('group-urgent')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
          <span className="stat__n mono">{stats.urgent}</span>
          <span className="stat__l">Closing in 7 days</span>
        </button>
        <button className={`stat ${scope === 'private' ? 'is-active' : ''}`} onClick={() => { setTab('open'); setScope('private'); setOnlyNew(false) }}>
          <span className="stat__n mono">{stats.private}</span>
          <span className="stat__l">Private ≥ ₹{prof.privateMinPayLakh} LPA</span>
        </button>
        <button className={`stat stat--sky ${onlyNew ? 'is-active' : ''}`} onClick={() => { setTab('open'); setOnlyNew((v) => !v) }}>
          <span className="stat__n mono">{stats.isNew}</span>
          <span className="stat__l">New since last visit</span>
        </button>
      </div>

      <div className="toolbar">
        <label className="search">
          <Icon name="list" size={15} />
          <input id="job-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, role, city…" aria-label="Search jobs" />
          {q ? (
            <button className="iconbtn iconbtn--sm" aria-label="Clear" onClick={() => setQ('')}>
              <Icon name="x" size={14} />
            </button>
          ) : null}
        </label>
      </div>
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
          {([
            ['all', 'Everything'],
            ['govt', `Govt · PSU · bank (${stats.govt})`],
            ['private', `Private ≥ ₹${prof.privateMinPayLakh} LPA (${stats.private})`],
          ] as [Scope, string][]).map(([id, label]) => (
            <button key={id} className={`filter ${scope === id ? 'is-active' : ''}`} onClick={() => setScope(id)}>
              {label}
            </button>
          ))}
          <span className="filters__sep" />
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
            <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Verified employers only
          </label>
          <label className="filter filter--toggle">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show low fit / needs experience
          </label>
          <select className="filter" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
            <option value="deadline">By deadline</option>
            <option value="fit">By fit</option>
            <option value="pay">By pay</option>
            <option value="new">Newest first</option>
          </select>
        </div>
      </div>
      {sources.length >= 2 ? (
        <div className="toolbar">
          <div className="filters filters--rail" role="group" aria-label="Source">
            <button className={`filter ${source === 'all' ? 'is-active' : ''}`} onClick={() => setSource('all')}>
              All sources
            </button>
            {sources.map(([name, n]) => (
              <button key={name} className={`filter ${source === name ? 'is-active' : ''}`} onClick={() => setSource(source === name ? 'all' : name)}>
                {name} <span className="filter__n">{n}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="empty">
          <Icon name="list" size={28} />
          <p>
            {q
              ? 'Nothing matches that search.'
              : source !== 'all'
                ? `No listing from ${source} clears the bar today.`
                : tab === 'open'
                ? scope === 'private'
                  ? 'No private listing today clears the fresher and pay bar. The portal scan runs every morning at 08:00 IST.'
                  : 'No open postings match. The daily job adds new ones each morning.'
                : tab === 'expected'
                  ? 'Nothing expected in this track yet.'
                  : 'Nothing here.'}
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.id} className="jobs__group" id={`group-${g.id}`}>
            {g.title ? (
              <h2 className="jobs__title">
                {g.title} <span className="muted">· {g.items.length}</span>
              </h2>
            ) : null}
            <ul className={`jobs ${pre}`}>
              {g.items.map((o, i) => (
                <JobRow
                  key={o.id}
                  o={o}
                  i={i}
                  tab={tab}
                  isOpen={expanded === o.id}
                  onToggle={() => setExpanded(expanded === o.id ? null : o.id)}
                  J={J}
                  swipe={swipe}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <div className="jobs__foot muted small">
        <p>
          Swipe a row right to mark it applied, left to hide it. Every action can be undone from the toast. Remind adds the opening to Exams and opens a prefilled GitHub issue; submit it and the morning job adds it to the shared data so email, Telegram and WhatsApp reminders cover it.
        </p>
        <p>
          Govt list curated {opportunities.curatedAt ? `on ${fmtShort(opportunities.curatedAt)}` : 'from research'}; news discovery {opportunities.discoveredAt ? `last ran ${fmtShort(opportunities.discoveredAt)}` : 'pending'}.
          {opportunities.portalAt ? ` Portals scanned ${fmtShort(opportunities.portalAt)}: ` : ' Portal scan pending: '}
          {portalStatus.length
            ? portalStatus.map((s, i) => (
                <span key={s.name} title={s.error ?? undefined}>
                  {i ? ' · ' : ''}
                  {statusLabel(s)}
                </span>
              ))
            : 'Indeed · Glassdoor · Naukri · Foundit · Unstop · LinkedIn · Internshala · iimjobs · TimesJobs · Shine · Freshersworld · Adzuna · Jooble'}
          {portalRan.length && !portalOk.length ? ' (every portal failed; check the Actions log)' : ''}. Blocked portals refuse GitHub's servers; "– off" needs an API key in the repo secrets (see README). Fit is a keyword score, not eligibility advice.
        </p>
      </div>
    </div>
  )
}

function JobRow({ o, i, tab, isOpen, onToggle, J, swipe }: { o: JobItem; i: number; tab: Tab; isOpen: boolean; onToggle: () => void; J: ReturnType<typeof useJobs>; swipe: React.MutableRefObject<{ id: string; x: number; dx: number } | null> }) {
  const { jobs } = J
  const tracked = J.trackedId(o)
  const applied = jobs.applied.includes(o.id)
  const payMin = o.payMinLakh ?? o.payLakh ?? null
  const payGood = payMin != null && payMin >= (J.prof.privateMinPayLakh ?? 10)
  const exp = experienceLabel(o, J.prof)
  const checked = o.checkedVia === 'exa' ? 'listing page read via Exa' : o.checked ? 'listing page opened and read' : o.sourceType === 'portal' ? 'only the portal summary was readable' : null
  const posted = o.postedAt ?? o.firstSeen?.slice(0, 10)
  const grade = (o.fit ?? 0) >= 70 ? 'high' : (o.fit ?? 0) >= 45 ? 'mid' : 'low'
  return (
    <li
      id={`job-${o.id}`}
      className={`job ${isOpen ? 'is-open' : ''} ${applied ? 'is-applied' : ''} ${o.isNew ? 'is-new' : ''}`}
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
        if (dx > 110) J.markApplied(o)
        else if (dx < -110) J.dontWant(o)
      }}
    >
      <span className="job__hint job__hint--right" aria-hidden="true">Applied</span>
      <span className="job__hint job__hint--left" aria-hidden="true">Hide</span>
      <button className="job__main" onClick={onToggle} aria-expanded={isOpen}>
        <span className="job__top">
          <span className="job__org">
            {o.isNew ? <span className="dot dot--new" aria-label="New" /> : null}
            {o.org}
          </span>
          <span className="job__right">
            {o.pay && (payMin != null || o.pay.length <= 22) ? <span className={`job__pay mono ${payGood ? 'is-good' : ''}`}>{o.pay}</span> : null}
            <span className={`fit fit--${grade}`} title={(o.fitWhy ?? []).join(', ')}>
              {o.fit}
            </span>
          </span>
        </span>
        <span className="job__post">{o.post}</span>
        <span className="job__meta">
          {o.status === 'open' && o.applyCloses ? (
            <span className={`job__due ${o.days != null && o.days <= 5 ? 'is-urgent' : ''}`}>
              <Icon name="clock" size={12} /> closes {fmtShort(o.applyCloses)} · {relative(o.days ?? null)}
            </span>
          ) : o.status === 'open' && posted ? (
            <span className="job__due muted">
              <Icon name="clock" size={12} /> posted {fmtShort(posted)}
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
          {o.locations?.length ? (
            <span className="muted">
              · <Icon name="pin" size={11} /> {o.locations.slice(0, 3).join(', ')}
              {o.locations.length > 3 ? ` +${o.locations.length - 3}` : ''}
            </span>
          ) : null}
          {o.vacancies ? <span className="muted">· {o.vacancies} posts</span> : null}
        </span>
        <span className="job__tags">
          <span className={`src ${exp.tone === 'ok' ? 'src--ok' : exp.tone === 'warn' ? 'src--warn' : 'src--muted'}`} title={exp.long}>{exp.text}</span>
          {o.sourceType === 'portal' ? <span className={`src ${o.trust === 'verified' ? 'src--ok' : ''}`} title={o.trust === 'verified' ? 'Employer is on the known-company list' : 'Employer is not on the known-company list; check the company before applying'}>{o.trust === 'verified' ? '✓ Verified employer' : 'Unverified employer'}</span> : null}
          {o.sourceType === 'portal' && o.payStated === false ? <span className="src">pay not listed</span> : null}
          <span className={`src src--${o.sourceType}`}>{o.sourceType === 'portal' ? o.source : o.sourceType}</span>
          {applied ? <span className="src src--applied">applied</span> : tracked ? <span className="src src--tracked">tracking</span> : null}
          {jobs.reminded.includes(o.id) ? <span className="src src--tracked">reminder</span> : null}
          {o.track && o.track !== 'private' ? <span className="src">{TRACKS.find((t) => t.id === o.track)?.label ?? o.track}</span> : null}
          {o.private && o.sector === 'nbfc' ? <span className="src">NBFC</span> : null}
        </span>
      </button>
      <div className={`job__expand ${isOpen ? 'is-open' : ''}`}>
        <div className="job__expand-inner">
          <dl className="qf">
            <Row k="Experience" v={`${exp.long}${checked ? ` · ${checked}` : ''}`} />
            {o.sourceType !== 'portal' && o.eligibility ? <Row k="Eligibility" v={o.eligibility} /> : null}
            {o.ageMax ? <Row k="Age" v={`≤ ${o.ageMax} (SC relaxation usually +5)`} /> : null}
            {o.vacancies ? <Row k="Vacancies" v={String(o.vacancies)} /> : null}
            {o.pay ? <Row k="Pay" v={o.pay} /> : null}
            {o.applyOpens || o.applyCloses ? <Row k="Apply" v={`${o.applyOpens ? fmtShort(o.applyOpens) : '—'} → ${o.applyCloses ? fmtShort(o.applyCloses) : '—'}`} /> : null}
            {o.examDate ? <Row k="Exam" v={`${fmtShort(o.examDate)}${o.examDateType === 'tentative' ? ' (tentative)' : ''}`} /> : null}
            {o.lastCycle ? <Row k="Last cycle" v={o.lastCycle} /> : null}
            {o.locations?.length ? <Row k="Where" v={o.locations.join(', ')} /> : null}
            {o.summary ? <Row k="Listing" v={plainText(o.summary) + '…'} /> : null}
            {o.website ? <Row k="Company site" v={o.website} /> : null}
            {o.note ? <Row k="Note" v={o.note} /> : null}
            <Row k="Why it fits" v={(o.fitWhy ?? []).join(' · ') || '—'} />
            <Row k="Source" v={`${o.source ?? o.sourceType}${o.sourceType === 'portal' ? ' — apply on the portal; confirm the CTC in the listing' : o.sourceType !== 'official' ? ' — verify on the official site before paying any fee' : ''}`} />
          </dl>
          <div className="job__actions">
            <a className="btn btn--accent btn--sm" href={o.link} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} /> {o.status === 'expected' ? 'Official site' : 'Open listing'}
            </a>
            {tab === 'dismissed' || tab === 'applied' ? (
              <button className="btn btn--sm" onClick={() => J.restore(o)}>
                <Icon name="refresh" size={14} /> Restore
              </button>
            ) : null}
            {!applied ? (
              <button className="btn btn--sm" onClick={() => J.markApplied(o)}>
                <Icon name="check" size={14} /> Applied
              </button>
            ) : null}
            <button className="btn btn--sm" onClick={() => J.remind(o)} title="Adds it to Exams and opens a GitHub issue so email / Telegram / WhatsApp reminders cover it">
              <Icon name="bell" size={14} /> {jobs.reminded.includes(o.id) ? 'Remind again' : 'Remind'}
            </button>
            {tracked ? (
              <button className="btn btn--ghost btn--sm" onClick={() => J.openInExams(tracked)}>
                <Icon name="exams" size={14} /> In Exams
              </button>
            ) : (
              <button className="btn btn--ghost btn--sm" onClick={() => J.track(o)}>
                <Icon name="plus" size={14} /> Track
              </button>
            )}
            {!jobs.dismissed.includes(o.id) ? (
              <button className="btn btn--ghost btn--sm" onClick={() => J.dontWant(o)}>
                <Icon name="x" size={14} /> Don't want
              </button>
            ) : null}
            <button className="btn btn--ghost btn--sm btn--danger" onClick={() => J.del(o)}>
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        </div>
      </div>
    </li>
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
