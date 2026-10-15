import { useMemo, useState } from 'react'
import { useApp } from '../ctx'
import { useEntrance } from '../lib/useEntrance'
import { Icon } from '../components/Icon'
import { seenStore } from '../lib/storage'
import { formatDistanceToNow } from 'date-fns'
import { isFresh } from '../lib/data'
import { KINDS, RELEVANT_DAYS, dateOf, dayGroup, headlineOf, isRelevant, kindOf, publisherOf } from '../lib/updates'
import { fmtShort } from '../lib/dates'
import type { Update, UpdateKind } from '../types'

const KIND_LABEL: Record<UpdateKind, string> = { ...Object.fromEntries(KINDS.map((k) => [k.id, k.label])), other: 'General' } as Record<UpdateKind, string>

export function Updates() {
  const { updates, status, exams } = useApp()
  const pre = useEntrance([])
  const seen = seenStore.use()
  const [mode, setMode] = useState<'relevant' | 'all'>('relevant')
  const [examFilter, setExamFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState<UpdateKind | 'all'>('all')
  const [hideRead, setHideRead] = useState(false)

  const pool = useMemo(() => {
    const rows = mode === 'relevant' ? updates.updates.filter((u) => isRelevant(u)) : updates.updates
    return rows.slice().sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || (b.firstSeen ?? '').localeCompare(a.firstSeen ?? ''))
  }, [updates, mode])
  const list = useMemo(
    () => pool.filter((u) => (examFilter === 'all' || u.examId === examFilter) && (kindFilter === 'all' || kindOf(u) === kindFilter) && (!hideRead || !seen.ids.includes(u.id))),
    [pool, examFilter, kindFilter, hideRead, seen],
  )
  const isNew = (u: Update) => isFresh(u) && !seen.ids.includes(u.id)
  const unseen = list.filter(isNew)
  const nameOf = (id: string) => exams.find((e) => e.id === id)?.short ?? id
  const markAll = () => seenStore.set({ ids: Array.from(new Set([...seen.ids, ...list.map((u) => u.id)])) })
  const relevantCount = updates.updates.filter((u) => isRelevant(u)).length
  const groups = useMemo(() => {
    const out: { label: string; rows: Update[] }[] = []
    for (const u of list) {
      const label = dayGroup(u)
      const g = out[out.length - 1]
      if (g && g.label === label) g.rows.push(u)
      else out.push({ label, rows: [u] })
    }
    return out
  }, [list])

  return (
    <div className="view">
      <header className="view__head">
        <div>
          <h1 className="view__title">Updates</h1>
          <p className="muted">
            Admit cards, results, dates and notices from official sites and news, refreshed every morning.
            {updates.updatedAt ? ` Last refresh ${formatDistanceToNow(new Date(updates.updatedAt), { addSuffix: true })}.` : ' No run yet.'}
          </p>
        </div>
        {unseen.length ? (
          <button className="btn" onClick={markAll}>
            <Icon name="check" size={14} /> Mark all read ({unseen.length})
          </button>
        ) : null}
      </header>

      <div className="filters filters--rail" aria-label="Scope">
        <button className={`filter ${mode === 'relevant' ? 'is-active' : ''}`} onClick={() => setMode('relevant')} title={`Actionable items from the last ${RELEVANT_DAYS} days`}>
          Relevant <span className="filter__n">{relevantCount}</span>
        </button>
        <button className={`filter ${mode === 'all' ? 'is-active' : ''}`} onClick={() => setMode('all')} title="Everything captured, including older and general coverage">
          Everything <span className="filter__n">{updates.updates.length}</span>
        </button>
        <label className="toggle toggle--inline">
          <input type="checkbox" checked={hideRead} onChange={(e) => setHideRead(e.target.checked)} /> Hide read
        </label>
      </div>
      <div className="filters" aria-label="Exam">
        <button className={`filter ${examFilter === 'all' ? 'is-active' : ''}`} onClick={() => setExamFilter('all')}>
          All exams <span className="filter__n">{pool.length}</span>
        </button>
        {exams.map((e) => {
          const n = pool.filter((u) => u.examId === e.id).length
          if (!n) return null
          return (
            <button key={e.id} className={`filter ${examFilter === e.id ? 'is-active' : ''}`} onClick={() => setExamFilter(e.id)}>
              {e.short} <span className="filter__n">{n}</span>
            </button>
          )
        })}
      </div>
      <div className="filters" aria-label="Type">
        <button className={`filter ${kindFilter === 'all' ? 'is-active' : ''}`} onClick={() => setKindFilter('all')}>
          All types
        </button>
        {KINDS.map((k) => {
          const n = pool.filter((u) => kindOf(u) === k.id && (examFilter === 'all' || u.examId === examFilter)).length
          if (!n) return null
          return (
            <button key={k.id} className={`filter ${kindFilter === k.id ? 'is-active' : ''}`} onClick={() => setKindFilter(k.id)}>
              <span className={`kdot kdot--${k.id}`} /> {k.label} <span className="filter__n">{n}</span>
            </button>
          )
        })}
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <Icon name="updates" size={32} />
          <p>
            {mode === 'relevant'
              ? `Nothing actionable in the last ${RELEVANT_DAYS} days for this filter. Everything shows older and general coverage.`
              : 'No updates captured yet. The daily job writes them here; run it manually from GitHub Actions to fetch now.'}
          </p>
        </div>
      ) : (
        <ul className={`feed ${pre}`}>
          {groups.map((g) => (
            <li key={g.label} className="feed__group">
              <div className="feed__day">{g.label}</div>
              <ul className="feed__rows">
                {g.rows.map((u) => {
                  const kind = kindOf(u)
                  const fresh = isNew(u)
                  return (
                    <li key={u.id} className={`feed__item ${fresh ? 'is-new' : ''} ${kind === 'other' ? 'is-general' : ''}`} style={{ ['--i' as string]: Math.min(list.indexOf(u), 10) }}>
                      <div className="feed__meta">
                        <span className={`pill pill--kind pill--${kind}`}>{KIND_LABEL[kind]}</span>
                        <span className="pill">{nameOf(u.examId)}</span>
                        <span className="muted small">{publisherOf(u)}</span>
                        <span className="muted small mono">{fmtShort(dateOf(u))}</span>
                        {u.alsoIn && u.alsoIn > 1 ? <span className="muted small">+{u.alsoIn - 1} more outlet{u.alsoIn > 2 ? 's' : ''}</span> : null}
                        {fresh ? <span className="tag tag--new">NEW</span> : null}
                      </div>
                      <a href={u.url} target="_blank" rel="noreferrer" className="feed__title" onClick={() => seenStore.set({ ids: [...seen.ids, u.id] })}>
                        {headlineOf(u)} <Icon name="external" size={13} />
                      </a>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <section className="panel">
        <h2 className="panel__title">
          <Icon name="refresh" /> Source health
        </h2>
        <p className="muted small">Direct fetch first; if a government site blocks bots or needs JavaScript, the job retries through a rendering proxy (shown as "reader"). News feeds catch what the sites hide; only admit-card, result, date, notice, answer-key, cut-off and interview headlines are kept.</p>
        {status.sources.length === 0 ? (
          <p className="muted">No scrape run recorded yet.</p>
        ) : (
          <table className="srctable">
            <thead>
              <tr>
                <th>Exam</th>
                <th>Source</th>
                <th>Status</th>
                <th>Items</th>
                <th>Via</th>
              </tr>
            </thead>
            <tbody>
              {status.sources.map((s) => (
                <tr key={s.url} className={s.ok ? '' : 'is-err'}>
                  <td>{nameOf(s.examId)}</td>
                  <td>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                  </td>
                  <td>{s.ok ? 'OK' : `Failed · ${s.error ?? 'unreachable'}`}</td>
                  <td className="mono">{s.items}</td>
                  <td className="muted small">{s.via ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
