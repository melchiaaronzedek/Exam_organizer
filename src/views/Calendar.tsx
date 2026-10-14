import { useApp } from '../ctx'
import { CalendarMonth } from '../components/CalendarMonth'
import { Icon } from '../components/Icon'
import { buildICS, downloadText } from '../lib/ics'
import { prefsStore } from '../lib/storage'
import { daysUntil, fmtDate, relative } from '../lib/dates'

export function Calendar() {
  const { events } = useApp()
  const prefs = prefsStore.use()
  const upcoming = events.filter((e) => e.status !== 'done' && daysUntil(e.date)! >= 0)
  return (
    <div className="view">
      <header className="view__head">
        <div>
          <h1 className="view__title">Calendar</h1>
          <p className="muted">Every phase of every exam. Dashed items are tentative.</p>
        </div>
        <button className="btn" onClick={() => downloadText('pariksha-desk.ics', buildICS(events, prefs.leadDays))}>
          <Icon name="download" size={14} /> Export .ics
        </button>
      </header>
      <div className="cal__layout">
        <CalendarMonth events={events} />
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
                  <span className="muted">
                    {' '}
                    · {relative(daysUntil(e.date))}
                    {e.venue || e.centre ? ` · ${e.venue || e.centre}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
