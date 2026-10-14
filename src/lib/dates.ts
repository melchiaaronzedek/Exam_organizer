import { differenceInCalendarDays, format, parseISO, isValid } from 'date-fns'

export function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function toDate(iso?: string | null): Date | null {
  if (!iso) return null
  const d = parseISO(iso)
  return isValid(d) ? d : null
}

export function daysUntil(iso?: string | null): number | null {
  const d = toDate(iso)
  if (!d) return null
  return differenceInCalendarDays(d, today())
}

export function fmtDate(iso?: string | null, pattern = 'EEE, d MMM yyyy'): string {
  const d = toDate(iso)
  return d ? format(d, pattern) : 'TBA'
}

export function fmtShort(iso?: string | null): string {
  return fmtDate(iso, 'd MMM')
}

export function relative(days: number | null): string {
  if (days == null) return 'date TBA'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days < 0) return `${-days} days ago`
  return `in ${days} days`
}

export function isoToday(): string {
  return format(today(), 'yyyy-MM-dd')
}

export interface CountdownParts {
  days: number
  hours: number
  minutes: number
  seconds: number
  past: boolean
}

/** Clock time named in a phase note ("Reporting 01:00 PM", "10:00–11:00 AM, reporting 8:30 AM"); the reporting time wins. */
export function timeFromNote(note?: string | null): { h: number; m: number } | null {
  if (!note) return null
  const rx = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi
  const pick = (text: string) => {
    for (const m of text.matchAll(rx)) {
      let h = Number(m[1])
      const min = Number(m[2] ?? 0)
      const ap = m[3]?.toLowerCase()
      if (!m[2] && !ap) continue // a bare number such as "Tier 2" is not a time
      if (h > 23 || min > 59) continue
      if (ap === 'pm' && h < 12) h += 12
      if (ap === 'am' && h === 12) h = 0
      return { h, m: min }
    }
    return null
  }
  const rep = /report(?:ing)?\s*(?:time|by|at)?\s*:?\s*([^,;)]*)/i.exec(note)
  return (rep && pick(rep[1])) || pick(note)
}

export function countdownTo(iso: string, now = new Date(), timeNote?: string | null): CountdownParts {
  const target = toDate(iso)
  if (!target) return { days: 0, hours: 0, minutes: 0, seconds: 0, past: false }
  // Count to the reporting time named in the phase note; exams without one are assumed to start at 08:00.
  const t = timeFromNote(timeNote) ?? { h: 8, m: 0 }
  target.setHours(t.h, t.m, 0, 0)
  let diff = target.getTime() - now.getTime()
  const past = diff < 0
  diff = Math.abs(diff)
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  const seconds = Math.floor((diff % 60_000) / 1000)
  return { days, hours, minutes, seconds, past }
}
