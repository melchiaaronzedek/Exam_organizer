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

export function countdownTo(iso: string, now = new Date()): CountdownParts {
  const target = toDate(iso)
  if (!target) return { days: 0, hours: 0, minutes: 0, seconds: 0, past: false }
  // Exams start in the morning; count to 08:00 local on that day.
  target.setHours(8, 0, 0, 0)
  let diff = target.getTime() - now.getTime()
  const past = diff < 0
  diff = Math.abs(diff)
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  const seconds = Math.floor((diff % 60_000) / 1000)
  return { days, hours, minutes, seconds, past }
}
