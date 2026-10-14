import type { CalEvent } from '../types'
import { daysUntil, relative, isoToday } from './dates'
import { prefsStore } from './storage'

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export async function requestPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  const res = await Notification.requestPermission()
  return res === 'granted'
}

/** Events due within the configured lead days (today counts). */
export function dueEvents(events: CalEvent[], leadDays: number[]): CalEvent[] {
  const maxLead = Math.max(...leadDays, 0)
  return events.filter((e) => {
    if (e.status === 'done') return false
    const d = daysUntil(e.date)
    return d != null && d >= 0 && d <= maxLead
  })
}

/** Fire at most one browser notification batch per day. */
export function maybeNotify(events: CalEvent[]) {
  const prefs = prefsStore.get()
  if (!prefs.notifications || !notificationsSupported() || Notification.permission !== 'granted') return
  const todayIso = isoToday()
  if (prefs.lastNotifyDay === todayIso) return
  const due = dueEvents(events, prefs.leadDays).filter((e) => prefs.leadDays.includes(daysUntil(e.date)!))
  if (due.length === 0) return
  const body = due
    .slice(0, 5)
    .map((e) => `${e.examShort} · ${e.label} ${relative(daysUntil(e.date))}${e.centre ? ` · ${e.centre}` : ''}`)
    .join('\n')
  try {
    new Notification(`Pariksha Desk — ${due.length} upcoming`, { body, tag: 'pariksha-daily' })
    prefsStore.set({ ...prefs, lastNotifyDay: todayIso })
  } catch {
    /* ignore */
  }
}
