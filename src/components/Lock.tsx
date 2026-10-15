import { useState, type FormEvent } from 'react'
import { Logo } from './Logo'
import { unlock } from '../lib/lock'

export function Lock({ onUnlocked }: { onUnlocked: () => void }) {
  const [pass, setPass] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pass || busy) return
    setBusy(true)
    setError(null)
    const ok = await unlock(pass, remember)
    setBusy(false)
    if (ok) {
      onUnlocked()
      return
    }
    setError("That passphrase didn't open it. Check it with whoever shared the tracker.")
    setShake((n) => n + 1)
    setPass('')
  }

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <form className="lock__card" key={shake} data-shake={shake > 0 ? '' : undefined} onSubmit={submit}>
        <Logo size={60} pulse />
        <h1 id="lock-title" className="lock__title">Jenny's Tracker</h1>
        <p className="lock__sub">This tracker is private. Enter the passphrase you were given.</p>
        <label className="lock__field">
          <span>Passphrase</span>
          <input type="password" autoFocus autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={!!error} />
        </label>
        <label className="lock__remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device
        </label>
        {error ? (
          <p className="lock__error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn--accent lock__btn" type="submit" disabled={busy || !pass}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
