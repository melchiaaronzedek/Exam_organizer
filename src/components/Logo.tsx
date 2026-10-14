import { useRef } from 'react'

interface Props {
  size?: number
  /** 0..1 share of the ring to fill (e.g. how close the next exam is). */
  progress?: number
  interactive?: boolean
  spinning?: boolean
  pulse?: boolean
  className?: string
  title?: string
}

/**
 * The Pariksha Desk mark: a ring (the countdown) with a notch at twelve (today)
 * and a "P" whose stem is a bookmark. The arc fills as the next exam approaches.
 * Interactive: tilts toward the pointer, sweeps on hover, presses down on tap.
 */
export function Logo({ size = 32, progress = 0, interactive = false, spinning = false, pulse = false, className = '', title = 'Pariksha Desk' }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const r = 42
  const C = 2 * Math.PI * r
  const filled = Math.max(0.04, Math.min(1, progress)) * C

  const onMove = (e: React.PointerEvent) => {
    if (!interactive || !ref.current || e.pointerType === 'touch') return
    const b = ref.current.getBoundingClientRect()
    const x = (e.clientX - b.left) / b.width - 0.5
    const y = (e.clientY - b.top) / b.height - 0.5
    ref.current.style.setProperty('--rx', `${(-y * 18).toFixed(1)}deg`)
    ref.current.style.setProperty('--ry', `${(x * 18).toFixed(1)}deg`)
  }
  const onLeave = () => {
    if (!ref.current) return
    ref.current.style.setProperty('--rx', '0deg')
    ref.current.style.setProperty('--ry', '0deg')
  }

  return (
    <span
      ref={ref}
      className={`logo ${interactive ? 'logo--interactive' : ''} ${spinning ? 'logo--spin' : ''} ${pulse ? 'logo--pulse' : ''} ${className}`}
      style={{ width: size, height: size }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      role="img"
      aria-label={title}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <circle className="logo__track" cx="50" cy="50" r={r} fill="none" strokeWidth="7" />
        <circle
          className="logo__arc"
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${C}`}
          transform="rotate(-90 50 50)"
        />
        <circle className="logo__notch" cx="50" cy="8" r="5" />
        {/* P: stem is a bookmark, bowl is open */}
        <path className="logo__glyph" d="M38 72 V30 h14 a11 11 0 0 1 0 22 H38" fill="none" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <path className="logo__flag" d="M38 72 l5 -5 l5 5" fill="none" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
