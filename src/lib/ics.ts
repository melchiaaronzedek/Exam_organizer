import type { CalEvent } from '../types'

function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function ymd(iso: string) {
  return iso.replace(/-/g, '')
}

function nextDay(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** All-day events with alarms the day before and the week before. */
export function buildICS(events: CalEvent[], leadDays: number[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//Jenny's Tracker//Exam Calendar//EN",
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    "X-WR-CALNAME:Jenny's Tracker — Exams",
    'X-WR-TIMEZONE:Asia/Kolkata',
  ]
  for (const e of events) {
    const where = e.venue || e.centre || (e.centrePrefs?.length ? `Pref: ${e.centrePrefs.join(' / ')}` : '')
    const summary = `${e.examShort}: ${e.label}${e.dateType === 'tentative' ? ' (tentative)' : ''}`
    const desc = [e.examTitle, e.timeNote, where ? `Centre: ${where}` : '', `Status: ${e.status}`].filter(Boolean).join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@jenny-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(e.dateEnd && e.kind !== 'application' ? e.dateEnd : e.date))}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(desc)}`,
      where ? `LOCATION:${esc(where)}` : '',
      `CATEGORIES:${e.kind.toUpperCase()}`,
    )
    for (const d of leadDays.filter((x) => x > 0)) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, `TRIGGER:-P${d}D`, 'END:VALARM')
    }
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:-PT2H', 'END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.filter(Boolean).join('\r\n') + '\r\n'
}

export function downloadText(filename: string, text: string, mime = 'text/calendar') {
  const blob = new Blob([text], { type: mime })
  downloadBlob(filename, blob)
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
