import { Logo } from './Logo'

export function DashboardSkeleton() {
  return (
    <div className="dash" aria-busy="true" aria-label="Loading">
      <div className="sk-logo"><Logo size={40} spinning progress={0.3} /></div>
      <div className="sk sk--line" style={{ width: 260 }} />
      <div className="dash__top">
        <div className="sk sk--hero" />
        <div className="sk sk--panel" />
      </div>
      <div className="tiles">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="sk sk--tile" />
        ))}
      </div>
      <div className="dash__cols">
        <div className="sk sk--panel" />
        <div className="sk sk--panel" />
        <div className="sk sk--panel" />
      </div>
    </div>
  )
}
