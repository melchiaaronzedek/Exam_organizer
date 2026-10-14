import { useEffect, useState } from 'react'
import { countdownTo } from '../lib/dates'

export function Countdown({ iso, compact = false }: { iso: string; compact?: boolean }) {
  const [parts, setParts] = useState(() => countdownTo(iso))
  useEffect(() => {
    const t = setInterval(() => setParts(countdownTo(iso)), 1000)
    return () => clearInterval(t)
  }, [iso])
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
