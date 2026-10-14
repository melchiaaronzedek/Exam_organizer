import { useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { Icon } from '../components/Icon'
import { exportLocalState, importLocalState, overridesStore, prefsStore, profileStore } from '../lib/storage'
import { notificationsSupported, requestPermission } from '../lib/notify'
import { downloadText } from '../lib/ics'
import { clearVault } from '../lib/vault'

const REPO = 'https://github.com/melchiaaronzedek/Exam_organizer'
const ICS_URL = `${location.origin}${import.meta.env.BASE_URL}calendar.ics`

export function Settings() {
  const { generatedAt, refreshDocCounts, profile } = useApp()
  const prefs = prefsStore.use()
  const po = profileStore.use()
  const [installEvt, setInstallEvt] = useState<Event | null>(null)
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setInstallEvt(e) }
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)
  const [copied, setCopied] = useState(false)
  const toggleLead = (d: number) => {
    const set = new Set(prefs.leadDays)
    set.has(d) ? set.delete(d) : set.add(d)
    prefsStore.set({ ...prefs, leadDays: [...set].sort((a, b) => b - a) })
  }
  return (
    <div className="view view--narrow">
      <header className="view__head">
        <div>
          <h1 className="view__title">Settings</h1>
          <p className="muted">Exam data version {generatedAt || '—'}. Everything on this page is stored only in this browser.</p>
        </div>
      </header>

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="download" /> Install on your phone
        </h2>
        {standalone ? (
          <p className="muted">Installed. You're running the app from the home screen.</p>
        ) : (
          <>
            <p className="muted small">Adds Jenny Tracker to the home screen, full-screen, with offline access to the last loaded data.</p>
            {installEvt ? (
              <button className="btn btn--accent" onClick={() => (installEvt as unknown as { prompt: () => void }).prompt()}>
                <Icon name="download" size={14} /> Install app
              </button>
            ) : (
              <ul className="notes">
                <li>iPhone: Share → Add to Home Screen.</li>
                <li>Android (Chrome): menu ⋮ → Add to Home screen / Install app.</li>
              </ul>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="list" /> Job matching
        </h2>
        <p className="muted small">{profile.headline}</p>
        <div className="private__grid">
          <label className="editor__wide">
            Roles to match (comma separated)
            <input value={(po.roles ?? profile.roles).join(', ')} onChange={(e) => profileStore.set({ ...po, roles: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} />
          </label>
          <label>
            Minimum pay (LPA)
            <input type="number" min={0} value={po.minPayLakh ?? profile.minPayLakh} onChange={(e) => profileStore.set({ ...po, minPayLakh: Number(e.target.value) })} />
          </label>
          <label>
            Preferred cities
            <input value={(po.cities ?? profile.cities).join(', ')} onChange={(e) => profileStore.set({ ...po, cities: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </label>
        </div>
        <div className="row">
          <button className="btn btn--ghost btn--sm" onClick={() => profileStore.set({})}>
            <Icon name="refresh" size={14} /> Reset to CV defaults
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="sun" /> Appearance
        </h2>
        <div className="row">
          <button className={`btn ${prefs.theme === 'ink' ? 'btn--accent' : 'btn--ghost'}`} onClick={() => prefsStore.set({ ...prefs, theme: 'ink' })}>
            <Icon name="moon" size={14} /> Ink (dark)
          </button>
          <button className={`btn ${prefs.theme === 'paper' ? 'btn--accent' : 'btn--ghost'}`} onClick={() => prefsStore.set({ ...prefs, theme: 'paper' })}>
            <Icon name="sun" size={14} /> Paper (light)
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="bell" /> Reminders
        </h2>
        <p>Remind me this many days before each date:</p>
        <div className="row">
          {[14, 7, 3, 1, 0].map((d) => (
            <button key={d} className={`filter ${prefs.leadDays.includes(d) ? 'is-active' : ''}`} onClick={() => toggleLead(d)}>
              {d === 0 ? 'On the day' : `${d} day${d > 1 ? 's' : ''}`}
            </button>
          ))}
        </div>
        <div className="setting">
          <div>
            <strong>Browser notifications</strong>
            <p className="muted small">One summary per day when you open the site and something is due.</p>
          </div>
          <button
            className={`btn ${prefs.notifications ? 'btn--accent' : 'btn--ghost'}`}
            disabled={!notificationsSupported()}
            onClick={async () => {
              if (prefs.notifications) return prefsStore.set({ ...prefs, notifications: false })
              const ok = await requestPermission()
              prefsStore.set({ ...prefs, notifications: ok })
            }}
          >
            {notificationsSupported() ? (prefs.notifications ? 'On' : 'Turn on') : 'Unsupported'}
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Email reminders (GitHub Issues)</strong>
            <p className="muted small">
              The daily GitHub Action opens an issue for each upcoming date and mentions you, so GitHub emails you. Enabled automatically; manage at{' '}
              <a href={`${REPO}/issues?q=label%3Areminder`} target="_blank" rel="noreferrer">
                repo issues
              </a>
              .
            </p>
          </div>
        </div>
        <div className="setting">
          <div>
            <strong>Telegram / WhatsApp</strong>
            <p className="muted small">
              Add <code>TELEGRAM_BOT_TOKEN</code> + <code>TELEGRAM_CHAT_ID</code> (or <code>CALLMEBOT_PHONE</code> + <code>CALLMEBOT_APIKEY</code> for WhatsApp) as repository secrets. Steps are in the README.
            </p>
          </div>
          <a className="btn btn--ghost" href={`${REPO}#reminders`} target="_blank" rel="noreferrer">
            <Icon name="external" size={14} /> README
          </a>
        </div>
        <div className="setting">
          <div>
            <strong>Calendar subscription</strong>
            <p className="muted small">Subscribe in Google Calendar (Other calendars → From URL) or your phone. Regenerated daily.</p>
            <code className="url">{ICS_URL}</code>
          </div>
          <button
            className="btn btn--ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(ICS_URL)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <Icon name="link" size={14} /> {copied ? 'Copied' : 'Copy URL'}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="settings" /> Profile (private)
        </h2>
        <div className="private__grid">
          <label>
            Name
            <input value={prefs.name ?? ''} onChange={(e) => prefsStore.set({ ...prefs, name: e.target.value })} placeholder="Shown on the dashboard greeting" />
          </label>
          <label>
            Category
            <select value={prefs.category ?? ''} onChange={(e) => prefsStore.set({ ...prefs, category: e.target.value })}>
              <option value="">—</option>
              {['UR', 'EWS', 'OBC', 'SC', 'ST'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          <Icon name="download" /> Backup & sync
        </h2>
        <p className="muted small">Your statuses, notes, centres and preferences. Export here, import on another device.</p>
        <div className="row">
          <button className="btn" onClick={() => downloadText('jenny-tracker-backup.json', exportLocalState(), 'application/json')}>
            <Icon name="download" size={14} /> Export settings JSON
          </button>
          <label className="btn btn--ghost">
            <Icon name="upload" size={14} /> Import JSON
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                importLocalState(await f.text())
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <div className="row">
          <button className="btn btn--danger" onClick={() => { if (confirm('Reset all local edits (statuses, notes, centres)? Documents stay.')) overridesStore.set({}) }}>
            <Icon name="refresh" size={14} /> Reset edits
          </button>
          <button className="btn btn--danger" onClick={async () => { if (confirm('Delete every document in the vault? This cannot be undone.')) { await clearVault(); refreshDocCounts() } }}>
            <Icon name="trash" size={14} /> Empty vault
          </button>
        </div>
      </section>
    </div>
  )
}
