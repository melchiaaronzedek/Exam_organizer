import { useState } from 'react'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import type { CalEvent } from '../types'
import { toDate, today, fmtDate, daysUntil, relative } from '../lib/dates'
import { Icon } from './Icon'
import { KIND_LABEL } from '../lib/data'

export function CalendarMonth({ events }: { events: CalEvent[] }) {
  const [cursor, setCursor] = useState(() => startOfMonth(today()))
  const [selected, setSelected] = useState<Date | null>(null)
  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start, end })
  const byDay = (d: Date) => events.filter((e) => {
    const s = toDate(e.date)!
    if (e.dateEnd && e.kind === 'application') {
      const s0 = toDate(e.date)!
      const e0 = toDate(e.dateEnd)!
      return d >= s0 && d <= e0
    }
    return isSameDay(s, d)
  })
  const sel = selected ? byDay(selected) : []

  return (
    <div className="cal">
      <div className="cal__bar">
        <button className="iconbtn" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="Previous month">
          <Icon name="left" />
        </button>
        <h3 className="cal__month">{format(cursor, 'MMMM yyyy')}</h3>
        <button className="iconbtn" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month">
          <Icon name="right" />
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => setCursor(startOfMonth(today()))}>
          Today
        </button>
      </div>
      <div className="cal__grid" role="grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="cal__dow">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const evs = byDay(d)
          const isToday = isSameDay(d, today())
          const out = !isSameMonth(d, cursor)
          return (
            <button
              key={d.toISOString()}
              className={`cal__day ${out ? 'is-out' : ''} ${isToday ? 'is-today' : ''} ${selected && isSameDay(d, selected) ? 'is-selected' : ''}`}
              onClick={() => setSelected(d)}
              aria-label={format(d, 'EEEE d MMMM')}
            >
              <span className="cal__num">{format(d, 'd')}</span>
              <span className="cal__evs">
                {evs.slice(0, 3).map((e) => (
                  <span key={e.id} className={`cal__ev cal__ev--${e.kind} ${e.dateType === 'tentative' ? 'is-tentative' : ''}`} title={`${e.examShort}: ${e.label}`}>
                    {e.examShort}
                  </span>
                ))}
                {evs.length > 3 ? <span className="cal__more">+{evs.length - 3}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
      <div className="cal__legend">
        {(['exam', 'application', 'admit-card', 'result', 'interview'] as const).map((k) => (
          <span key={k} className="legend">
            <i className={`legend__dot cal__ev--${k}`} /> {KIND_LABEL[k]}
          </span>
        ))}
        <span className="legend">
          <i className="legend__dot is-tentative" /> dashed = tentative
        </span>
      </div>
      {selected ? (
        <div className="cal__detail">
          <h4>{fmtDate(format(selected, 'yyyy-MM-dd'))}</h4>
          {sel.length === 0 ? (
            <p className="muted">Nothing scheduled.</p>
          ) : (
            <ul className="evlist">
              {sel.map((e) => (
                <li key={e.id} className={`evlist__item cal__ev--${e.kind}`}>
                  <div>
                    <strong>{e.examShort}</strong> · {e.label}
                    {e.dateType === 'tentative' ? <span className="tag tag--tentative">tentative</span> : null}
                  </div>
                  <div className="muted">
                    {relative(daysUntil(e.date))}
                    {e.timeNote ? ` · ${e.timeNote}` : ''}
                    {e.venue || e.centre ? ` · ${e.venue || e.centre}` : e.centrePrefs?.length ? ` · pref: ${e.centrePrefs.join(' / ')}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
