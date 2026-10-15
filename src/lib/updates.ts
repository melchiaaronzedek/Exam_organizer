import { differenceInCalendarDays } from 'date-fns'
import type { Update, UpdateKind } from '../types'

export const KINDS: { id: UpdateKind; label: string }[] = [
  { id: 'admit-card', label: 'Admit card' },
  { id: 'result', label: 'Result' },
  { id: 'notification', label: 'Notification' },
  { id: 'exam-date', label: 'Exam date' },
  { id: 'answer-key', label: 'Answer key' },
  { id: 'cut-off', label: 'Cut-off' },
  { id: 'interview', label: 'Interview' },
]
export const RELEVANT_DAYS = 30

/* Mirror of KIND_RULES in scraper/scrape.py, for items stored before the scraper started classifying. */
const RULES: [UpdateKind, RegExp][] = [
  ['admit-card', /admit card|hall ticket|call letter|city intimation|e-?admit/i],
  ['answer-key', /answer key|response sheet|objection/i],
  ['result', /\bresults?\b|merit list|score ?card|final selection|selection list|shortlist|list of (?:candidates|qualified)|marks (?:released|out)/i],
  ['cut-off', /cut[- ]?off\b(?!.*\?)(?=.*\b(?:released|out|announced|declared|official|category[- ]wise)\b)|qualifying marks/i],
  ['interview', /interview|document verification|\bdv\b|medical exam|joining|appointment letter/i],
  ['exam-date', /exam dates?|exam schedule|\bschedule\b|postponed|rescheduled|time ?table|date sheet|exam (?:on|from|to begin|begins|starts)|to be held|tier[- ]?\d.{0,20}\b(?:on|from)\b/i],
  ['notification', /notification|recruitment .{0,30}\b(?:out|released|announced)\b|vacanc|apply online|registration|last date|application .{0,30}\b(?:open|extended|closes|begins|starts|reopen)|correction window|apply by|online form|\bout\b.{0,20}posts|posts? (?:announced|notified)/i],
]

export function kindOf(u: Update): UpdateKind {
  if (u.kind) return u.kind
  const t = headlineOf(u)
  return RULES.find(([, rx]) => rx.test(t))?.[0] ?? 'other'
}

/** Headline without the trailing " - Outlet" that Google News appends. */
export function headlineOf(u: Update): string {
  if (u.publisher) return u.title
  const m = /^(.{12,}?)\s[-–|]\s([^-–|]{2,40})$/.exec(u.title)
  return m && m[2].split(' ').length <= 4 ? m[1] : u.title
}

export function publisherOf(u: Update): string {
  if (u.publisher) return u.publisher
  const m = /^(.{12,}?)\s[-–|]\s([^-–|]{2,40})$/.exec(u.title)
  return m && m[2].split(' ').length <= 4 ? m[2] : u.source.replace(/\s*\(Google News\)/, '')
}

export function dateOf(u: Update): string {
  return (u.publishedAt ?? u.firstSeen).slice(0, 10)
}

export function ageDays(u: Update, now = new Date()): number {
  return differenceInCalendarDays(now, new Date(dateOf(u)))
}

/** Actionable (admit card, result, dates…) and from the last 30 days. */
export function isRelevant(u: Update, now = new Date()): boolean {
  return kindOf(u) !== 'other' && ageDays(u, now) <= RELEVANT_DAYS
}

export function dayGroup(u: Update, now = new Date()): string {
  const d = ageDays(u, now)
  if (d <= 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d <= 7) return 'This week'
  if (d <= 30) return 'This month'
  return 'Earlier'
}
