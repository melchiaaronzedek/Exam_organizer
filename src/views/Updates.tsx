import { useMemo, useState } from 'react'
import { useApp } from '../ctx'
import { Icon } from '../components/Icon'
import { seenStore } from '../lib/storage'
import { formatDistanceToNow } from 'date-fns'

export function Updates() {
  const { updates, status, exams } = useApp()
  const seen = seenStore.use()
  const [examFilter, setExamFilter] = useState('all')
  const list = useMemo(
    () => updates.updates.filter((u) => examFilter === 'all' || u.examId === examFilter).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)),
    [updates, examFilter],
  )
  const unseen = list.filter((u) => !seen.ids.includes(u.id))
  const nameOf = (id: string) => exams.find((e) => e.id === id)?.short ?? id
  const markAll = () => seenStore.set({ ids: Array.from(new Set([...seen.ids, ...updates.updates.map((u) => u.id)])) })

  return (
    <div className="view">
      <header className="view__head">
        <div>
          <h1 className="view__title">Updates</h1>
          <p className="muted">
            Scraped from official sites and news every morning at 08:00 IST.
            {updates.updatedAt ? ` Last refresh ${formatDistanceToNow(new Date(updates.updatedAt), { addSuffix: true })}.` : ' No run yet.'}
          </p>
        </div>
        {unseen.length ? (
          <button className="btn" onClick={markAll}>
            <Icon name="check" size={14} /> Mark all read ({unseen.length})
          </button>
        ) : null}
      </header>
      <div className="filters">
        <button className={`filter ${examFilter === 'all' ? 'is-active' : ''}`} onClick={() => setExamFilter('all')}>
          All <span className="filter__n">{updates.updates.length}</span>
        </button>
        {exams.map((e) => {
          const n = updates.updates.filter((u) => u.examId === e.id).length
          if (!n) return null
          return (
            <button key={e.id} className={`filter ${examFilter === e.id ? 'is-active' : ''}`} onClick={() => setExamFilter(e.id)}>
              {e.short} <span className="filter__n">{n}</span>
            </button>
          )
        })}
      </div>
      {list.length === 0 ? (
        <div className="empty">
          <Icon name="updates" size={32} />
          <p>No updates captured yet. The daily job writes them here; run it manually from GitHub Actions to fetch now.</p>
        </div>
      ) : (
        <ul className="feed">
          {list.map((u) => {
            const isNew = !seen.ids.includes(u.id)
            return (
              <li key={u.id} className={`feed__item ${isNew ? 'is-new' : ''}`}>
                <div className="feed__meta">
                  <span className="pill">{nameOf(u.examId)}</span>
                  <span className="muted small">{u.source}</span>
                  <span className="muted small mono">{u.publishedAt ? u.publishedAt.slice(0, 10) : u.firstSeen.slice(0, 10)}</span>
                  {isNew ? <span className="tag tag--new">NEW</span> : null}
                </div>
                <a href={u.url} target="_blank" rel="noreferrer" className="feed__title" onClick={() => seenStore.set({ ids: [...seen.ids, u.id] })}>
                  {u.title} <Icon name="external" size={13} />
                </a>
              </li>
            )
          })}
        </ul>
      )}
      <section className="panel">
        <h2 className="panel__title">
          <Icon name="refresh" /> Source health
        </h2>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
