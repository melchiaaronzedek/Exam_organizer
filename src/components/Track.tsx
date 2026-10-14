import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isWeekend } from 'date-fns'
import type { CalEvent } from '../types'
import { daysUntil, fmtDate, fmtShort, today } from '../lib/dates'
import { mapsUrl } from '../lib/data'
import { Icon } from './Icon'
import { useEntrance } from '../lib/useEntrance'

export type TrackRange = 30 | 75 | 120

interface Props {
  events: CalEvent[]
  range: TrackRange
  onRange: (r: TrackRange) => void
  onOpen: (examId: string) => void
}

interface Chip {
  e: CalEvent
  day: number
  x: number
  w: number
  lane: number
  place: string | null
  label: string
}

const LANE_H = 30
const AXIS_H = 34
const MIN_PX_DAY = 14
const GAP = 8

function estimateWidth(label: string) {
  return Math.min(300, 30 + label.length * 7.1)
}

export function Track({ events, range, onRange, onOpen }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [hover, setHover] = useState<Chip | null>(null)
  const pre = useEntrance([])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const pxDay = Math.max(MIN_PX_DAY, width / range)
  const trackW = pxDay * range

  const { chips, lanes, spans } = useMemo(() => {
    const inRange = events.filter((e) => {
      const d = daysUntil(e.date)!
      return e.status !== 'done' && d >= 0 && d <= range
    })
    const list: Chip[] = inRange.map((e) => {
      const day = daysUntil(e.date)!
      const place = e.kind === 'application' ? null : e.venue || e.centre || (e.centrePrefs?.[0] ? `${e.centrePrefs[0]}?` : null)
      const label = `${e.examShort} · ${e.label}${place ? ` · ${place}` : ''}`
      return { e, day, x: day * pxDay, w: estimateWidth(label), lane: 0, place, label }
    })
    list.sort((a, b) => a.x - b.x || a.e.kind.localeCompare(b.e.kind))
    const laneEnds: number[] = []
    for (const c of list) {
      let lane = laneEnds.findIndex((end) => end + GAP <= c.x)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(0)
      }
      c.lane = lane
      laneEnds[lane] = c.x + c.w
    }
    const spans = inRange
      .filter((e) => e.kind === 'application' && e.dateEnd && e.date !== e.dateEnd)
      .map((e) => {
        const from = Math.max(0, daysUntil(e.date)!)
        const to = daysUntil(e.dateEnd!)!
        return { e, x1: from * pxDay, x2: to * pxDay }
      })
    return { chips: list, lanes: Math.max(1, laneEnds.length), spans }
  }, [events, range, pxDay])

  // Auto-scroll so today sits at the left edge when the track overflows.
  useEffect(() => {
    if (wrapRef.current && trackW > width + 2) wrapRef.current.scrollTo({ left: 0 })
  }, [trackW, width])

  const days = Array.from({ length: range + 1 }, (_, i) => addDays(today(), i))
  const months = days.filter((d, i) => i === 0 || d.getDate() === 1)
  const height = AXIS_H + lanes * LANE_H + 14 + (spans.length ? 14 : 0)

  return (
    <div className="track">
      <div className="track__bar">
        <span className="muted small">
          {chips.length} date{chips.length === 1 ? '' : 's'} · {lanes} lane{lanes === 1 ? '' : 's'}
        </span>
        <div className="seg" role="radiogroup" aria-label="Range">
          {([30, 75, 120] as TrackRange[]).map((r) => (
            <button key={r} role="radio" aria-checked={range === r} className={`seg__btn ${range === r ? 'is-active' : ''}`} onClick={() => onRange(r)}>
              {r}d
            </button>
          ))}
        </div>
      </div>
      <div className={`track__wrap ${trackW > width + 2 ? 'is-scroll' : ''}`} ref={wrapRef}>
        <div className={`track__canvas ${pre}`} style={{ width: trackW, height }}>
          {days.map((d, i) =>
            isWeekend(d) ? <span key={i} className="track__weekend" style={{ left: i * pxDay, width: pxDay }} aria-hidden="true" /> : null,
          )}
          {days.map((_, i) =>
            i % 7 === 0 ? <span key={`t${i}`} className="track__tick" style={{ left: i * pxDay }} aria-hidden="true" /> : null,
          )}
          {months.map((d) => {
            const i = daysUntil(format(d, 'yyyy-MM-dd'))!
            return (
              <span key={d.toISOString()} className="track__month mono" style={{ left: i * pxDay + 6 }}>
                {format(d, i === 0 ? 'MMM' : 'MMMM')}
              </span>
            )
          })}
          {days.map((d, i) =>
            i % 7 === 0 && i > 0 ? (
              <span key={`d${i}`} className="track__daynum mono" style={{ left: i * pxDay + 4 }}>
                {format(d, 'd')}
              </span>
            ) : null,
          )}
          <span className="track__today" aria-hidden="true">
            <span className="track__todaypill mono">today</span>
          </span>
          <span className="track__axis" style={{ top: AXIS_H }} aria-hidden="true" />

          {spans.map(({ e, x1, x2 }) => (
            <span key={`s${e.id}`} className={`track__span cal__ev--${e.kind}`} style={{ left: x1, width: Math.max(4, x2 - x1), top: AXIS_H + lanes * LANE_H + 10 }} title={`${e.examShort} application window`} />
          ))}

          {chips.map((c, i) => (
            <button
              key={c.e.id}
              className={`track__chip cal__ev--${c.e.kind} ${c.e.dateType === 'tentative' ? 'is-tentative' : ''}`}
              style={{ left: c.x, top: AXIS_H + 8 + c.lane * LANE_H, maxWidth: c.w, ['--i' as string]: Math.min(i, 8) }}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover((h) => (h === c ? null : h))}
              onFocus={() => setHover(c)}
              onBlur={() => setHover(null)}
              onClick={() => onOpen(c.e.examId)}
              aria-label={`${c.label}, ${fmtDate(c.e.date)}`}
            >
              <span className="track__dot" />
              <span className="track__text">
                <strong>{c.e.examShort}</strong> {c.e.label}
                <span className="track__date mono"> {fmtShort(c.e.date)}</span>
                {c.place ? <span className="track__place"> · {c.place}</span> : null}
              </span>
            </button>
          ))}

          {hover ? (
            <div className="track__tip" style={{ left: Math.min(hover.x, trackW - 280), top: AXIS_H + 8 + hover.lane * LANE_H + 30 }} role="tooltip">
              <div className="track__tiptitle">
                <strong>{hover.e.examShort}</strong> · {hover.e.label}
                {hover.e.dateType === 'tentative' ? <span className="tag tag--tentative">tentative</span> : null}
              </div>
              <div className="mono muted small">
                {fmtDate(hover.e.date, 'EEE, d MMM yyyy')}
                {hover.e.timeNote ? ` · ${hover.e.timeNote}` : ''}
              </div>
              {hover.e.kind !== 'application' ? (
                <div className="track__tipplace">
                  <Icon name="pin" size={12} />
                  {hover.e.venue || hover.e.centre ? (
                    <>
                      <span>{hover.e.venue || hover.e.centre}</span>
                      <a href={mapsUrl(hover.e.venue || hover.e.centre!)} target="_blank" rel="noreferrer" className="placeline__map">
                        map
                      </a>
                    </>
                  ) : hover.e.centrePrefs?.length ? (
                    <span className="muted">Pref: {hover.e.centrePrefs.join(' / ')}</span>
                  ) : (
                    <span className="muted">Centre not chosen</span>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
