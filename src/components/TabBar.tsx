import { Icon } from './Icon'

export interface Tab {
  id: string
  label: string
  icon: string
  badge?: number
}

export function TabBar({ tabs, active, onSelect }: { tabs: Tab[]; active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <button key={t.id} className={`tab ${active === t.id ? 'is-active' : ''}`} onClick={() => onSelect(t.id)} aria-current={active === t.id ? 'page' : undefined}>
          <span className="tab__icon">
            <Icon name={t.icon} size={22} />
            {t.badge ? <span className="tab__badge">{t.badge > 99 ? '99+' : t.badge}</span> : null}
          </span>
          <span className="tab__label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
