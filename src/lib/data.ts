import type { CalEvent, Exam, ExamOverride, ExamsFile, Phase, PhaseKind, ScrapeStatusFile, UpdatesFile } from '../types'
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
  const [exams, updates, status] = await Promise.all([
    getJSON<ExamsFile>('data/exams.json', { generatedAt: '', exams: [] }),
    getJSON<UpdatesFile>('data/updates.json', { updatedAt: null, updates: [] }),
    getJSON<ScrapeStatusFile>('data/scrape_status.json', { lastRun: null, sources: [] }),
  ])
  return { exams, updates, status }
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
        venue: po?.venue,
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
