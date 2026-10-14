import type { CalEvent, DocumentsFile, OpportunitiesFile, Profile, Update, Exam, ExamOverride, ExamsFile, Phase, PhaseKind, ScrapeStatusFile, UpdatesFile } from '../types'
import { daysUntil } from './dates'

const base = import.meta.env.BASE_URL

async function getJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${base}${path}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

export async function loadAll() {
  const [exams, updates, status, documents, profile, opportunities] = await Promise.all([
    getJSON<ExamsFile>('data/exams.json', { generatedAt: '', exams: [] }),
    getJSON<UpdatesFile>('data/updates.json', { updatedAt: null, updates: [] }),
    getJSON<ScrapeStatusFile>('data/scrape_status.json', { lastRun: null, sources: [] }),
    getJSON<DocumentsFile>('data/documents.json', { count: 0, documents: [] }),
    getJSON<Profile>('data/profile.json', { headline: '', education: [], ageOn: '', qualifications: [], roles: [], sectors: [], excludeTerms: [], homeStates: [], cities: [], minPayLakh: 0 }),
    getJSON<OpportunitiesFile>('data/opportunities.json', { curated: [], discovered: [] }),
  ])
  return { exams, updates, status, documents, profile, opportunities }
}

/** Apply browser-stored overrides on top of the public exam data. */
export function mergeExam(exam: Exam, ov?: ExamOverride): Exam {
  if (!ov) return exam
  const phases = exam.phases.map((p) => {
    const po = ov.phases?.[p.id]
    if (!po) return p
    const merged: Phase = { ...p }
    if (po.date !== undefined) merged.date = po.date || undefined
    if (po.dateType) merged.dateType = po.dateType
    if (po.status) merged.status = po.status
    if (po.allotted !== undefined || po.venue !== undefined) {
      merged.centre = {
        preferences: p.centre?.preferences ?? [],
        allotted: po.allotted !== undefined ? po.allotted : p.centre?.allotted ?? null,
      }
    }
    if (po.note !== undefined) merged.note = po.note
    return merged
  })
  return {
    ...exam,
    status: ov.status ?? exam.status,
    application: {
      ...exam.application,
      applied: ov.applied ?? exam.application.applied,
      appliedOn: ov.appliedOn ?? exam.application.appliedOn,
    },
    phases,
  }
}

/** Auto-advance phase status from the calendar: a dated phase in the past is done. */
export function normalizePhase(p: Phase): Phase {
  if (p.status === 'tba' && p.date) return { ...p, status: daysUntil(p.dateEnd ?? p.date)! < 0 ? 'done' : 'upcoming' }
  if (p.status === 'upcoming' && p.date && daysUntil(p.dateEnd ?? p.date)! < 0) return { ...p, status: 'done' }
  return p
}

export function buildEvents(exams: Exam[], overrides: Record<string, ExamOverride>): CalEvent[] {
  const out: CalEvent[] = []
  for (const exam of exams) {
    const ov = overrides[exam.id]
    for (const raw of exam.phases) {
      const p = normalizePhase(raw)
      if (!p.date) continue
      const po = ov?.phases?.[p.id]
      out.push({
        id: `${exam.id}:${p.id}`,
        examId: exam.id,
        examShort: exam.short,
        examTitle: exam.title,
        phaseId: p.id,
        label: p.name,
        kind: p.kind,
        date: p.kind === 'application' && p.dateEnd ? p.dateEnd : p.date,
        dateEnd: p.dateEnd,
        dateType: p.dateType,
        centre: p.centre?.allotted ?? null,
        centrePrefs: p.centre?.preferences,
        venue: po?.venue || p.centre?.venue,
        timeNote: p.timeNote,
        status: p.status,
        examStatus: exam.status,
      })
    }
    // Application deadline when it is not already modelled as a phase.
    const hasApplyPhase = exam.phases.some((p) => p.kind === 'application')
    if (!hasApplyPhase && exam.application.closes && !exam.application.applied) {
      out.push({
        id: `${exam.id}:apply-close`,
        examId: exam.id,
        examShort: exam.short,
        examTitle: exam.title,
        phaseId: 'apply-close',
        label: 'Application closes',
        kind: 'application',
        date: exam.application.closes,
        dateType: 'confirmed',
        status: daysUntil(exam.application.closes)! < 0 ? 'done' : 'upcoming',
        examStatus: exam.status,
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export const KIND_LABEL: Record<PhaseKind, string> = {
  application: 'Deadline',
  'admit-card': 'Admit card',
  exam: 'Exam',
  result: 'Result',
  interview: 'Interview',
  other: 'Stage',
}

export const STATUS_LABEL: Record<Exam['status'], string> = {
  'to-apply': 'To apply',
  applied: 'Applied',
  written: 'Written',
  'result-awaited': 'Result awaited',
  closed: 'Closed',
}

export function examCity(exam: Exam): string | null {
  const next = exam.phases.map(normalizePhase).find((p) => p.status === 'upcoming' && p.centre)
  const c = next?.centre
  if (!c) return null
  return c.allotted || c.preferences[0] || null
}

/** City to show for a phase: allotted centre, else first preference. */
export function cityOf(p?: Phase | null): string | null {
  if (!p?.centre) return null
  return p.centre.allotted || p.centre.preferences[0] || null
}

export function mapsUrl(q: string) {
  return `https://www.google.com/maps/search/${encodeURIComponent(q)}`
}

export function nextPhase(exam: Exam): Phase | undefined {
  return exam.phases.map(normalizePhase).find((p) => p.status === 'upcoming' && p.date && daysUntil(p.date)! >= 0)
}

export function toCSV(events: CalEvent[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = [['Date', 'Exam', 'Phase', 'Type', 'Certainty', 'Centre', 'Preferences', 'Time', 'Status']]
  for (const e of events) rows.push([e.date, e.examShort, e.label, e.kind, e.dateType, e.venue || e.centre || '', (e.centrePrefs ?? []).join(' / '), e.timeNote ?? '', e.status])
  return rows.map((r) => r.map(esc).join(',')).join('\n')
}

/** An update counts as fresh when dated within 7 days, or undated and first seen within 2 days. */
export function isFresh(u: Update, now = new Date()): boolean {
  const ms = now.getTime()
  if (u.publishedAt) return ms - new Date(u.publishedAt.slice(0, 10)).getTime() <= 7 * 86_400_000
  return ms - new Date(u.firstSeen).getTime() <= 2 * 86_400_000
}

/** First centre preferences found on any phase (for cards without a dated next phase). */
export function anyPreferences(exam: Exam): { prefs: string[]; allotted: string | null; venue?: string; phase: string } | null {
  for (const p of exam.phases) {
    if (p.centre && (p.centre.preferences.length || p.centre.allotted)) {
      return { prefs: p.centre.preferences, allotted: p.centre.allotted ?? null, venue: p.centre.venue, phase: p.name }
    }
  }
  return null
}
