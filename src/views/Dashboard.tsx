import { useApp } from '../ctx'
import { useEntrance } from '../lib/useEntrance'
import { Countdown } from '../components/Countdown'
import { Icon } from '../components/Icon'
import { PlaceLine } from '../components/CalendarMonth'
import { Track, type TrackRange } from '../components/Track'
import { addDays, format } from 'date-fns'
import { daysUntil, fmtDate, fmtShort, relative, today } from '../lib/dates'
import { KIND_LABEL, cityOf, isFresh, mapsUrl, nextPhase } from '../lib/data'
import { StatusChip } from '../components/StatusChip'
import { dueEvents } from '../lib/notify'
import { prefsStore, seenStore } from '../lib/storage'
import { useJobs } from '../lib/useJobs'
import type { CalEvent } from '../types'

export function Dashboard() {
  const { exams, events, updates, navigate } = useApp()
  const pre = useEntrance([])
  const prefs = prefsStore.use()
  const range: TrackRange = prefs.trackRange ?? 75
  const openExam = (id: string) => {
    navigate('exams')
    setTimeout(() => document.getElementById(`exam-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }
  const seen = seenStore.use()
  const J = useJobs()
  const topJobs = J.all
    .filter((o) => o.status === 'open' && !J.hidden(o) && o.expOk && (o.fit ?? 0) >= 45)
    .sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || (b.fit ?? 0) - (a.fit ?? 0) || (a.days ?? 9999) - (b.days ?? 9999))
    .slice(0, 4)
  const openJob = (id: string) => {
    navigate('jobs')
    setTimeout(() => window.dispatchEvent(new CustomEvent('jt:focus-job', { detail: { id } })), 120)
  }
  const upcoming = events.filter((e) => e.status !== 'done' && daysUntil(e.date)! >= 0)
  const hero = upcoming.find((e) => e.kind === 'exam') ?? upcoming[0]
  const due = dueEvents(events, prefs.leadDays)
  const toApply = exams.filter((e) => e.status === 'to-apply')
  const applied = exams.filter((e) => e.application.applied)
  const written = exams.filter((e) => e.status === 'written' || e.status === 'result-awaited')
  const next30 = upcoming.filter((e) => daysUntil(e.date)! <= 30)
  const unseen = updates.updates.filter((u) => isFresh(u) && !seen.ids.includes(u.id))
  const examSoon = upcoming.find((e) => e.kind === 'exam' && daysUntil(e.date)! <= 1)
  const examSoonExam = examSoon ? exams.find((x) => x.id === examSoon.examId) : undefined
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const cities = new Map<string, { exam: (typeof exams)[number]; when: string | undefined; allotted: boolean }[]>()
  for (const ex of exams) {
    const np = nextPhase(ex)
    const c = cityOf(np)
    if (!c || !np) continue
    cities.set(c, [...(cities.get(c) ?? []), { exam: ex, when: np.date, allotted: !!np.centre?.allotted }])
  }

  return (
    <div className="dash">
      <p className="greet">
        {greet}
        {prefs.name ? `, ${prefs.name.split(' ')[0]}` : ''} · {format(today(), 'EEEE, d MMMM')}
      </p>

      <div className="dash__top">
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
                <PlaceLine e={hero} />
                <button className="btn btn--ghost btn--sm" onClick={() => navigate('exams')}>
                  Open exam <Icon name="chevron" size={14} />
                </button>
              </div>
            </>
          ) : (
            <h1 className="hero__title">No upcoming dates</h1>
          )}
        </section>

        {examSoon && examSoonExam ? (
          <section className="panel examday">
            <h2 className="panel__title">
              <Icon name="alert" /> Exam day {daysUntil(examSoon.date) === 0 ? 'is today' : 'is tomorrow'}
            </h2>
            <p className="examday__what">
              <strong>{examSoon.examShort}</strong> · {examSoon.label}
              {examSoon.timeNote ? <span className="muted"> · {examSoon.timeNote}</span> : null}
            </p>
            <PlaceLine e={examSoon} />
            {examSoon.venue || examSoon.centre ? (
              <a className="btn btn--accent btn--sm" href={mapsUrl(examSoon.venue || examSoon.centre!)} target="_blank" rel="noreferrer">
                <Icon name="pin" size={14} /> Directions
              </a>
            ) : (
              <p className="muted small">Allotted centre not entered. Open the exam, tap the pencil on this phase and paste the venue from the admit card.</p>
            )}
            {examSoonExam.facts?.carry?.length ? (
              <>
                <h3 className="panel__sub">Carry</h3>
                <ul className="carry">
                  {examSoonExam.facts.carry.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : (
          <WeekStrip events={upcoming} />
        )}
      </div>

      <section className="tiles">
        <Tile n={toApply.length} label="to apply" accent="amber" onClick={() => navigate('exams')} />
        <Tile n={applied.length} label="applied" accent="teal" onClick={() => navigate('exams')} />
        <Tile n={written.length} label="written · awaiting result" accent="violet" onClick={() => navigate('exams')} />
        <Tile n={next30.length} label="dates in next 30 days" accent="rose" onClick={() => navigate('calendar')} bars={[0, 30, 60].map((from) => upcoming.filter((e) => daysUntil(e.date)! >= from && daysUntil(e.date)! < from + 30).length)} />
        <Tile n={unseen.length} label="unread updates" accent="sky" onClick={() => navigate('updates')} />
      </section>

      <div className="dash__cols">
        <section className="panel">
          <h2 className="panel__title">
            <Icon name="alert" /> Due soon
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
                    {e.kind !== 'application' ? <span className="muted"> · {e.venue || e.centre || (e.centrePrefs?.[0] ? `${e.centrePrefs[0]} (pref)` : 'centre TBA')}</span> : null}
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
                    <span className="row">
                      <span className="mono">{ex.application.closes ? `closes ${fmtShort(ex.application.closes)} · ${relative(daysUntil(ex.application.closes))}` : 'deadline TBA'}</span>
                      {ex.applyUrl ? (
                        <a className="btn btn--accent btn--sm" href={ex.applyUrl} target="_blank" rel="noreferrer">
                          Apply
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="panel">
          <h2 className="panel__title">
            <Icon name="city" /> Centres
          </h2>
          {cities.size === 0 ? (
            <p className="muted">No centres recorded.</p>
          ) : (
            <ul className="citylist">
              {[...cities.entries()].map(([city, list]) => (
                <li key={city}>
                  <span className="citylist__city">
                    {city}
                    <a className="placeline__map" href={mapsUrl(city)} target="_blank" rel="noreferrer">
                      map
                    </a>
                  </span>
                  <span className="citylist__exams">
                    {list.map((x) => (
                      <span key={x.exam.id} className="pill" title={x.allotted ? 'Allotted centre' : 'First preference, allotment awaited'}>
                        {x.exam.short} · {fmtShort(x.when)}
                        {x.allotted ? '' : ' ?'}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">? means first preference; the allotted centre comes with the admit card.</p>
        </section>

        <section className="panel">
          <h2 className="panel__title">
            <Icon name="link" /> Links
          </h2>
          <ul className="linklist">
            {exams.map((ex) => (
              <li key={ex.id}>
                <a href={ex.officialUrl} target="_blank" rel="noreferrer">
                  <Icon name="external" size={13} /> {ex.short}
                </a>
                <span className="muted small">{ex.org}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {topJobs.length ? (
        <section className="panel">
          <h2 className="panel__title">
            <Icon name="list" /> Top matches
            <button className="btn btn--ghost btn--sm panel__action" onClick={() => navigate('jobs')}>
              All jobs <Icon name="chevron" size={13} />
            </button>
          </h2>
          <ul className="matches">
            {topJobs.map((o) => (
              <li key={o.id}>
                <button className="match" onClick={() => openJob(o.id)}>
                  <span className="match__top">
                    <span className="job__org">{o.isNew ? <span className="dot dot--new" aria-label="New" /> : null}{o.org}</span>
                    <span className={`fit fit--${(o.fit ?? 0) >= 70 ? 'high' : 'mid'}`}>{o.fit}</span>
                  </span>
                  <span className="match__post">{o.post}</span>
                  <span className="match__meta muted">
                    {o.pay ? <span className="mono">{o.pay}</span> : null}
                    {o.applyCloses ? <span>closes {fmtShort(o.applyCloses)} · {relative(o.days)}</span> : o.postedAt ? <span>posted {fmtShort(o.postedAt)}</span> : null}
                    {o.locations?.length ? <span>{o.locations.slice(0, 2).join(', ')}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="calendar" /> Next {range} days
        </h2>
        <Track events={events} range={range} onRange={(r) => prefsStore.set({ ...prefs, trackRange: r })} onOpen={openExam} />
        <ul className="tl-list">
          {upcoming
            .filter((e) => daysUntil(e.date)! <= range)
            .map((e) => (
              <li key={e.id} className={`tl-list__item cal__ev--${e.kind}`}>
                <span className="mono tl-list__date">{fmtShort(e.date)}</span>
                <span>
                  <strong>{e.examShort}</strong> · {e.label}
                  {e.dateType === 'tentative' ? <span className="tag tag--tentative">tentative</span> : null}
                  {e.kind !== 'application' && (e.centre || e.centrePrefs?.[0]) ? <span className="muted"> · {e.venue || e.centre || `${e.centrePrefs![0]}?`}</span> : null}
                </span>
              </li>
            ))}
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="exams" /> All exams
        </h2>
        <div className={`minigrid ${pre}`}>
          {exams.map((ex) => {
            const nxt = events.find((e) => e.examId === ex.id && e.status !== 'done' && daysUntil(e.date)! >= 0)
            const city = cityOf(nextPhase(ex))
            return (
              <button key={ex.id} className="mini" style={{ ['--i' as string]: Math.min(exams.indexOf(ex), 10) }} onClick={() => openExam(ex.id)}>
                <span className="mini__top">
                  <span className="mini__short">{ex.short}</span>
                  <StatusChip status={ex.status} />
                </span>
                <span className="mini__org">{ex.org}</span>
                <span className="mini__next mono">{nxt ? `${nxt.label} · ${fmtShort(nxt.date)}` : 'next date TBA'}</span>
                {city ? (
                  <span className="mini__city">
                    <Icon name="pin" size={11} /> {city}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Tile({ n, label, accent, onClick, bars }: { n: number; label: string; accent: string; onClick: () => void; bars?: number[] }) {
  const max = bars ? Math.max(1, ...bars) : 1
  return (
    <button className={`tile tile--${accent}`} onClick={onClick}>
      <span className="tile__n">{n}</span>
      <span className="tile__label">{label}</span>
      {bars ? (
        <span className="tile__bars" aria-hidden="true" title={`Next 30 / 60 / 90 days: ${bars.join(' · ')}`}>
          {bars.map((b, i) => (
            <i key={i} style={{ height: `${Math.max(12, (b / max) * 100)}%` }} />
          ))}
        </span>
      ) : null}
    </button>
  )
}

function WeekStrip({ events }: { events: CalEvent[] }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i))
  return (
    <section className="panel week">
      <h2 className="panel__title">
        <Icon name="calendar" /> This week
      </h2>
      <div className="week__grid">
        {days.map((d) => {
          const iso = format(d, 'yyyy-MM-dd')
          const evs = events.filter((e) => e.date === iso || (e.dateEnd && e.kind === 'application' && e.date <= iso && e.dateEnd >= iso && e.dateEnd === iso))
          return (
            <div key={iso} className={`week__day ${evs.length ? 'has-ev' : ''}`}>
              <span className="week__dow">{format(d, 'EEE')}</span>
              <span className="week__num">{format(d, 'd')}</span>
              <span className="week__evs">
                {evs.map((e) => (
                  <span key={e.id} className={`cal__ev cal__ev--${e.kind} ${e.dateType === 'tentative' ? 'is-tentative' : ''}`}>
                    <span className="cal__ev-name">{e.examShort}</span>
                    {e.kind !== 'application' && (e.centre || e.centrePrefs?.[0]) ? <span className="cal__ev-place">{e.centre || `${e.centrePrefs![0]}?`}</span> : null}
                  </span>
                ))}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
