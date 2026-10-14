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
  const byCity = new Map<string, typeof upcoming>()
  for (const e of upcoming) {
    if (e.kind === 'application') continue
    const c = e.venue || e.centre || e.centrePrefs?.[0] || 'Centre TBA'
    byCity.set(c, [...(byCity.get(c) ?? []), e])
  }
  return (
    <div className="view">
      <header className="view__head">
        <div>
          <h1 className="view__title">Calendar</h1>
          <p className="muted">Every phase of every exam with its centre. Dashed items are tentative.</p>
        </div>
        <div className="row">
          <button className="btn btn--ghost" onClick={() => downloadText('pariksha-schedule.csv', toCSV(events), 'text/csv')}>
            <Icon name="download" size={14} /> CSV
          </button>
          <button className="btn" onClick={() => downloadText('pariksha-desk.ics', buildICS(events, prefs.leadDays))}>
            <Icon name="download" size={14} /> Export .ics
          </button>
          <button className="btn btn--ghost" onClick={() => window.print()}>
            <Icon name="file" size={14} /> Print
          </button>
        </div>
      </header>
      <div className="cal__layout">
        <CalendarMonth events={events} />
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
          <aside className="panel">
            <h2 className="panel__title">
              <Icon name="city" /> Travel plan by city
            </h2>
            <ul className="citylist">
              {[...byCity.entries()].map(([city, list]) => (
                <li key={city}>
                  <span className="citylist__city">{city}</span>
                  <span className="citylist__exams">
                    {list.map((e) => (
                      <span key={e.id} className="pill">
                        {e.examShort} · {fmtDate(e.date, 'd MMM')}
                      </span>
                    ))}
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
