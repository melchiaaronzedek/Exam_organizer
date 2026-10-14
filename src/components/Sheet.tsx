import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  full?: boolean
  action?: ReactNode
}

/** Bottom sheet (or full-screen page on phones when `full`). Swipe down or tap the scrim to close. */
export function Sheet({ open, onClose, title, children, full = false, action }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const start = useRef<{ y: number; t: number } | null>(null)
  const dy = useRef(0)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const onTouchStart = (e: React.TouchEvent) => {
    const el = panel.current
    if (!el || el.scrollTop > 0) return
    start.current = { y: e.touches[0].clientY, t: Date.now() }
    dy.current = 0
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current || !panel.current) return
    dy.current = Math.max(0, e.touches[0].clientY - start.current.y)
    panel.current.style.transform = `translateY(${dy.current}px)`
    panel.current.style.transition = 'none'
  }
  const onTouchEnd = () => {
    if (!start.current || !panel.current) return
    const v = dy.current / Math.max(1, Date.now() - start.current.t)
    panel.current.style.transition = ''
    panel.current.style.transform = ''
    if (dy.current > 90 || v > 0.5) onClose()
    start.current = null
  }

  return (
    <div className={`sheet ${open ? 'is-open' : ''} ${full ? 'sheet--full' : ''}`} aria-hidden={!open} {...(!open ? { inert: '' as unknown as boolean } : {})}>
      <div className="sheet__scrim" onClick={onClose} />
      <div className="sheet__panel" ref={panel} role="dialog" aria-modal="true" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div className="sheet__grip" aria-hidden="true" />
        {title !== undefined || action ? (
          <header className="sheet__head">
            <button className="iconbtn iconbtn--ghost" onClick={onClose} aria-label="Close">
              <Icon name={full ? 'left' : 'x'} />
            </button>
            <div className="sheet__title">{title}</div>
            <div className="sheet__action">{action}</div>
          </header>
        ) : null}
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  )
}
