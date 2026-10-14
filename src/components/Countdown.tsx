import { useEffect, useState } from 'react'
import { countdownTo } from '../lib/dates'

export function Countdown({ iso, timeNote, compact = false }: { iso: string; timeNote?: string | null; compact?: boolean }) {
  const [parts, setParts] = useState(() => countdownTo(iso, new Date(), timeNote))
  useEffect(() => {
    setParts(countdownTo(iso, new Date(), timeNote))
    const t = setInterval(() => setParts(countdownTo(iso, new Date(), timeNote)), 1000)
    return () => clearInterval(t)
  }, [iso, timeNote])
  const cells = [
    ['days', parts.days],
    ['hrs', parts.hours],
    ['min', parts.minutes],
    ['sec', parts.seconds],
  ] as const
  return (
    <div className={`countdown ${compact ? 'countdown--compact' : ''}`} role="timer" aria-live="off">
      {cells.map(([label, v], i) => (
        <div className="countdown__cell" key={label} style={{ animationDelay: `${i * 80}ms` }}>
          <span className="countdown__num">{String(v).padStart(2, '0')}</span>
          <span className="countdown__label">{label}</span>
        </div>
      ))}
    </div>
  )
}
