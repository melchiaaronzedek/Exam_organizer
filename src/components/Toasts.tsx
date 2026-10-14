import { dismissToast, useToasts } from '../lib/toast'
import { Icon } from './Icon'

export function Toasts() {
  const list = useToasts()
  if (!list.length) return null
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {list.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone ?? 'default'} ${t.leaving ? 'is-leaving' : ''}`} role="status">
          <span className="toast__msg">{t.message}</span>
          {t.action ? (
            <button
              className="btn btn--sm btn--accent"
              onClick={() => {
                t.action?.onClick()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button className="iconbtn iconbtn--sm" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
