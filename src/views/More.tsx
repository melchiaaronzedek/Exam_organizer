import { Icon } from '../components/Icon'
import { prefsStore } from '../lib/storage'

interface Item {
  id: string
  label: string
  icon: string
  hint?: string
  badge?: number
}

export function More({ items, onSelect }: { items: Item[]; onSelect: (id: string) => void }) {
  const prefs = prefsStore.use()
  return (
    <div className="more">
      <ul className="more__list">
        {items.map((it) => (
          <li key={it.id}>
            <button className="more__row" onClick={() => onSelect(it.id)}>
              <Icon name={it.icon} size={20} />
              <span className="more__text">
                <span className="more__label">{it.label}</span>
                {it.hint ? <span className="muted small">{it.hint}</span> : null}
              </span>
              {it.badge ? <span className="tab__badge tab__badge--inline">{it.badge}</span> : null}
              <Icon name="chevron" size={16} className="muted" />
            </button>
          </li>
        ))}
        <li>
          <button className="more__row" onClick={() => prefsStore.set({ ...prefs, theme: prefs.theme === 'ink' ? 'paper' : 'ink' })}>
            <Icon name={prefs.theme === 'ink' ? 'sun' : 'moon'} size={20} />
            <span className="more__text">
              <span className="more__label">{prefs.theme === 'ink' ? 'Light theme' : 'Dark theme'}</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  )
}
