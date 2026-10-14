import { useApp } from '../ctx'
import { CalendarMonth, PlaceLine } from '../components/CalendarMonth'
import { Icon } from '../components/Icon'
import { buildICS, downloadText } from '../lib/ics'
import { prefsStore } from '../lib/storage'
import { daysUntil, fmtDate, relative } from '../lib/dates'
import { toCSV } from '../lib/data'

export function Calendar() {
  const { events } = useApp()
  const prefs = prefsStore.use()
  const upcoming = events.filter((e) => e.status !== 'done' && daysUntil(e.date)! >= 0)
  const byCity = new Map<string, { items: typeof upcoming; venues: Set<string>; confirmed: boolean }>()
  for (const e of upcoming) {
    if (e.kind === 'application') continue
    const c = e.centre || e.centrePrefs?.[0] || 'Centre not chosen yet'
    const g = byCity.get(c) ?? { items: [], venues: new Set<string>(), confirmed: false }
    g.items.push(e)
    if (e.venue) g.venues.add(e.venue)
    if (e.centre) g.confirmed = true
    byCity.set(c, g)
  }
  return (
    <div className="view">
      <header className="view__head">
        <div>
          <h1 className="view__title">Calendar</h1>
          <p className="muted">Every phase of every exam with its centre. Dashed items are tentative.</p>
        </div>
        <div className="row">
          <button className="btn btn--ghost" onClick={() => downloadText('jenny-schedule.csv', toCSV(events), 'text/csv')}>
            <Icon name="download" size={14} /> CSV
          </button>
          <button className="btn" onClick={() => downloadText('jenny-tracker.ics', buildICS(events, prefs.leadDays))}>
            <Icon name="download" size={14} /> Export .ics
          </button>
          <button className="btn btn--ghost" onClick={() => window.print()}>
            <Icon name="file" size={14} /> Print
          </button>
        </div>
      </header>
      <div className="cal__layout">
        <div className="cal__main">
          <CalendarMonth events={events} />
          <aside className="panel">
            <h2 className="panel__title">
              <Icon name="city" /> Travel plan by city
            </h2>
            <ul className="citylist">
              {[...byCity.entries()].map(([city, g]) => (
                <li key={city}>
                  <span className="citylist__head">
                    <span className="citylist__city">{city}</span>
                    {!g.confirmed && city !== 'Centre not chosen yet' ? <span className="muted citylist__note">first preference, not yet allotted</span> : null}
                    {[...g.venues].map((v) => (
                      <span key={v} className="muted citylist__venue">{v}</span>
                    ))}
                  </span>
                  <span className="citylist__exams">
                    {g.items.map((e) => (
                      <span key={e.id} className={`pill cal__ev--${e.kind}${e.dateType === 'tentative' ? ' is-tentative' : ''}`}>
                        {e.examShort} · {fmtDate(e.date, 'd MMM')}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
        <div className="cal__side">
          <aside className="panel agenda">
            <h2 className="panel__title">
              <Icon name="list" /> Agenda
            </h2>
            <ul className="agenda__list">
              {upcoming.map((e) => (
                <li key={e.id} className={`agenda__item cal__ev--${e.kind}`}>
                  <span className="agenda__date mono">{fmtDate(e.date, 'd MMM')}</span>
                  <span className="agenda__body">
                    <strong>{e.examShort}</strong> · {e.label}
                    {e.dateType === 'tentative' ? <span className="tag tag--tentative">tentative</span> : null}
                    <span className="muted"> · {relative(daysUntil(e.date))}</span>
                    {e.timeNote ? <span className="muted"> · {e.timeNote}</span> : null}
                    <PlaceLine e={e} />
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  )
}
