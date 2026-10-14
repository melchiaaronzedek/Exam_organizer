import { useApp } from '../ctx'
import { Countdown } from '../components/Countdown'
import { Icon } from '../components/Icon'
import { daysUntil, fmtDate, fmtShort, relative } from '../lib/dates'
import { KIND_LABEL, examCity } from '../lib/data'
import { StatusChip } from '../components/StatusChip'
import { dueEvents } from '../lib/notify'
import { prefsStore, seenStore } from '../lib/storage'

export function Dashboard() {
  const { exams, events, updates, navigate } = useApp()
  const prefs = prefsStore.use()
  const seen = seenStore.use()
  const upcoming = events.filter((e) => e.status !== 'done' && daysUntil(e.date)! >= 0)
  const hero = upcoming.find((e) => e.kind === 'exam') ?? upcoming[0]
  const due = dueEvents(events, prefs.leadDays)
  const toApply = exams.filter((e) => e.status === 'to-apply')
  const applied = exams.filter((e) => e.application.applied)
  const written = exams.filter((e) => e.status === 'written' || e.status === 'result-awaited')
  const next30 = upcoming.filter((e) => daysUntil(e.date)! <= 30)
  const unseen = updates.updates.filter((u) => !seen.ids.includes(u.id))
  const cities = new Map<string, typeof exams>()
  for (const ex of exams) {
    const c = examCity(ex)
    if (!c) continue
    cities.set(c, [...(cities.get(c) ?? []), ex])
  }
  const windowEvents = upcoming.filter((e) => daysUntil(e.date)! <= 75)

  return (
    <div className="dash">
      <section className="hero">
        <div className="hero__bg" aria-hidden="true" />
        {hero ? (
          <>
            <p className="eyebrow">
              <Icon name="clock" size={14} /> Next {hero.kind === 'exam' ? 'exam' : KIND_LABEL[hero.kind].toLowerCase()}
              {hero.dateType === 'tentative' ? <span className="tag tag--tentative">tentative</span> : null}
            </p>
            <h1 className="hero__title">
              {hero.examShort}
              <span className="hero__phase"> · {hero.label}</span>
            </h1>
            <p className="hero__date mono">
              {fmtDate(hero.date, 'EEEE, d MMMM yyyy')}
              {hero.timeNote ? ` · ${hero.timeNote}` : ''}
            </p>
            <Countdown iso={hero.date} />
            <div className="hero__facts">
              <span>
                <Icon name="pin" size={14} />
                {hero.venue || hero.centre || (hero.centrePrefs?.length ? `Pref: ${hero.centrePrefs.join(' / ')}` : 'Centre TBA')}
              </span>
              <button className="btn btn--ghost btn--sm" onClick={() => navigate('exams')}>
                Open exam <Icon name="chevron" size={14} />
              </button>
            </div>
          </>
        ) : (
          <h1 className="hero__title">No upcoming dates</h1>
        )}
      </section>

      <section className="tiles">
        <Tile n={toApply.length} label="to apply" accent="amber" onClick={() => navigate('exams')} />
        <Tile n={applied.length} label="applied" accent="teal" onClick={() => navigate('exams')} />
        <Tile n={written.length} label="written · awaiting result" accent="violet" onClick={() => navigate('exams')} />
        <Tile n={next30.length} label="dates in next 30 days" accent="rose" onClick={() => navigate('calendar')} />
        <Tile n={unseen.length} label="unread updates" accent="sky" onClick={() => navigate('updates')} />
      </section>

      <div className="dash__cols">
        <section className="panel">
          <h2 className="panel__title">
            <Icon name="alert" /> Needs attention
          </h2>
          {due.length === 0 ? (
            <p className="muted">Nothing due within {Math.max(...prefs.leadDays)} days.</p>
          ) : (
            <ul className="duelist">
              {due.map((e) => (
                <li key={e.id} className={`due due--${e.kind}`}>
                  <span className="due__when mono">{relative(daysUntil(e.date))}</span>
                  <span className="due__what">
                    <strong>{e.examShort}</strong> · {e.label}
                    {e.centre || e.venue ? <span className="muted"> · {e.venue || e.centre}</span> : null}
                  </span>
                  <span className="due__date mono">{fmtShort(e.date)}</span>
                </li>
              ))}
            </ul>
          )}
          {toApply.length ? (
            <>
              <h3 className="panel__sub">Still to apply</h3>
              <ul className="applylist">
                {toApply.map((ex) => (
                  <li key={ex.id}>
                    <span>
                      <strong>{ex.short}</strong> <span className="muted">· {ex.post}</span>
                    </span>
                    <span className="mono">
                      {ex.application.closes ? `closes ${fmtShort(ex.application.closes)} · ${relative(daysUntil(ex.application.closes))}` : 'deadline TBA'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="panel">
          <h2 className="panel__title">
            <Icon name="city" /> By centre
          </h2>
          {cities.size === 0 ? (
            <p className="muted">No centres recorded yet.</p>
          ) : (
            <ul className="citylist">
              {[...cities.entries()].map(([city, list]) => (
                <li key={city}>
                  <span className="citylist__city">{city}</span>
                  <span className="citylist__exams">
                    {list.map((ex) => (
                      <span key={ex.id} className="pill">
                        {ex.short}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">City shown is the allotted centre when known, else your first preference.</p>
        </section>
      </div>

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="calendar" /> Next 75 days
        </h2>
        <Timeline events={windowEvents} />
      </section>

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="exams" /> All exams
        </h2>
        <div className="minigrid">
          {exams.map((ex) => {
            const nxt = events.find((e) => e.examId === ex.id && e.status !== 'done' && daysUntil(e.date)! >= 0)
            return (
              <button key={ex.id} className="mini" onClick={() => navigate('exams')}>
                <span className="mini__top">
                  <span className="mini__short">{ex.short}</span>
                  <StatusChip status={ex.status} />
                </span>
                <span className="mini__org">{ex.org}</span>
                <span className="mini__next mono">{nxt ? `${nxt.label} · ${fmtShort(nxt.date)}` : 'next date TBA'}</span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Tile({ n, label, accent, onClick }: { n: number; label: string; accent: string; onClick: () => void }) {
  return (
    <button className={`tile tile--${accent}`} onClick={onClick}>
      <span className="tile__n">{n}</span>
      <span className="tile__label">{label}</span>
    </button>
  )
}

function Timeline({ events }: { events: ReturnType<typeof useApp>['events'] }) {
  if (events.length === 0) return <p className="muted">Nothing in this window.</p>
  const first = 0
  const last = Math.max(75, daysUntil(events[events.length - 1].date)!)
  return (
    <div className="tl-wrap">
      <div className="tl">
      <div className="tl__axis">
        {[0, 15, 30, 45, 60, 75].map((d) => (
          <span key={d} className="tl__tick" style={{ left: `${((d - first) / (last - first)) * 100}%` }}>
            {d === 0 ? 'today' : `+${d}d`}
          </span>
        ))}
      </div>
      <ul className="tl__items">
        {events.map((e, i) => {
          const d = daysUntil(e.date)!
          const left = ((d - first) / (last - first)) * 100
          return (
            <li key={e.id} className={`tl__item cal__ev--${e.kind} ${e.dateType === 'tentative' ? 'is-tentative' : ''}`} style={{ left: `${left}%`, top: `${(i % 4) * 34}px`, animationDelay: `${i * 50}ms` }}>
              <span className="tl__dot" />
              <span className="tl__label">
                <strong>{e.examShort}</strong> {e.label} <span className="mono">{fmtShort(e.date)}</span>
              </span>
            </li>
          )
        })}
      </ul>
      </div>
      <ul className="tl-list">
        {events.map((e) => (
          <li key={e.id} className={`tl-list__item cal__ev--${e.kind}`}>
            <span className="mono tl-list__date">{fmtShort(e.date)}</span>
            <span>
              <strong>{e.examShort}</strong> · {e.label}
              {e.dateType === 'tentative' ? <span className="tag tag--tentative">tentative</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
