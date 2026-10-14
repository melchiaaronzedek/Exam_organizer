import { useCallback, useMemo, useRef } from 'react'
import { useApp } from '../ctx'
import { fitScore, isPrivate, isSouth, needsExperience } from './fit'
import { customExamsStore, jobsStore, profileStore, type JobsState } from './storage'
import { daysUntil, isoToday } from './dates'
import { toast } from './toast'
import type { Exam, Opportunity } from '../types'

export interface JobItem extends Opportunity {
  days: number | null
  south: boolean
  private: boolean
  expOk: boolean
  isNew: boolean
}

export const REPO_ISSUES = 'https://github.com/melchiaaronzedek/Exam_organizer/issues/new'

export function toExam(o: Opportunity, status: Exam['status']): Exam {
  return {
    id: `custom-${o.id}`,
    org: o.org,
    short: o.org.length > 14 ? o.org.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 8) : o.org,
    title: `${o.org} — ${o.post}`,
    post: o.post,
    status,
    officialUrl: o.link,
    applyUrl: o.link,
    application: { opens: o.applyOpens ?? undefined, closes: o.applyCloses ?? undefined, applied: status !== 'to-apply', appliedOn: status === 'applied' ? isoToday() : undefined, note: o.eligibility || undefined },
    phases: [
      ...(o.applyCloses ? [{ id: 'apply', name: 'Application window', kind: 'application' as const, date: o.applyOpens ?? o.applyCloses, dateEnd: o.applyCloses, dateType: 'confirmed' as const, status: (status === 'to-apply' ? 'upcoming' : 'done') as 'upcoming' | 'done' }] : []),
      { id: 'exam', name: 'Exam / selection', kind: 'exam' as const, date: o.examDate ?? undefined, dateType: o.examDate ? o.examDateType ?? 'tentative' : 'tba', status: o.examDate ? 'upcoming' : 'tba', centre: { preferences: [], allotted: null } },
      { id: 'interview', name: 'Interview', kind: 'interview' as const, dateType: 'tba' as const, status: 'tba' as const },
    ],
    facts: { vacancies: o.vacancies ? String(o.vacancies) : undefined, age: o.ageMax ? `≤ ${o.ageMax}` : undefined, pay: o.pay ?? undefined },
    notes: [o.source ? `Source: ${o.source} (${o.sourceType})` : ''].filter(Boolean),
    custom: true,
  }
}

/** All openings (curated + discovered + portal) scored against the profile, plus the row actions with undo. */
export function useJobs() {
  const { opportunities, profile, exams, addCustomExam, removeCustomExam, navigate } = useApp()
  const jobs = jobsStore.use()
  const po = profileStore.use()
  const lastVisit = useRef(jobs.lastVisit ?? '')
  const prof = useMemo(
    () => ({ ...profile, roles: po.roles ?? profile.roles, cities: po.cities ?? profile.cities, minPayLakh: po.minPayLakh ?? profile.minPayLakh, privateMinPayLakh: po.privateMinPayLakh ?? profile.privateMinPayLakh ?? 10 }),
    [profile, po],
  )

  const all = useMemo<JobItem[]>(() => {
    const since = lastVisit.current
    return [...opportunities.curated, ...opportunities.discovered, ...(opportunities.portal ?? [])].map((o) => {
      const f = fitScore(o, prof)
      const closes = o.applyCloses ?? null
      const d = closes ? daysUntil(closes) : null
      let status = o.status
      if (status === 'open' && d != null && d < 0) status = 'closed'
      const expOk = !needsExperience(o, prof)
      return {
        ...o,
        fit: expOk ? (o.curated ? Math.max(o.fit ?? 0, f.score) : o.sourceType === 'portal' ? o.fit ?? f.score : f.score) : 0,
        fitWhy: o.fitWhy?.length && expOk ? o.fitWhy : f.why,
        status,
        days: d,
        south: isSouth(o),
        private: isPrivate(o),
        expOk,
        isNew: !!since && !!o.firstSeen && o.firstSeen > since,
      }
    })
  }, [opportunities, prof])

  const hidden = useCallback((o: Opportunity) => jobs.dismissed.includes(o.id) || jobs.applied.includes(o.id) || (jobs.deleted ?? []).includes(o.id), [jobs])

  const snapshot = () => ({ jobs: jobsStore.get(), custom: customExamsStore.get() })
  const undo = (snap: ReturnType<typeof snapshot>) => () => {
    jobsStore.set(snap.jobs)
    customExamsStore.set(snap.custom)
  }

  const ensureTracked = (o: Opportunity, status: Exam['status']) => {
    const ex = toExam(o, status)
    if (!exams.some((e) => e.id === ex.id)) addCustomExam(ex)
    jobsStore.set((s) => ({ ...s, tracked: { ...s.tracked, [o.id]: ex.id } }))
    return ex
  }
  const track = (o: Opportunity) => {
    const snap = snapshot()
    ensureTracked(o, 'to-apply')
    toast(`Tracking ${o.org} in Exams`, { tone: 'success', action: { label: 'Undo', onClick: undo(snap) } })
  }
  const markApplied = (o: Opportunity) => {
    const snap = snapshot()
    ensureTracked(o, 'applied')
    jobsStore.set((s) => ({ ...s, applied: s.applied.includes(o.id) ? s.applied : [...s.applied, o.id], dismissed: s.dismissed.filter((x) => x !== o.id) }))
    toast(`Marked applied: ${o.org}`, { tone: 'success', action: { label: 'Undo', onClick: undo(snap) } })
  }
  const dontWant = (o: Opportunity) => {
    const snap = snapshot()
    jobsStore.set((s) => ({ ...s, dismissed: s.dismissed.includes(o.id) ? s.dismissed : [...s.dismissed, o.id], applied: s.applied.filter((x) => x !== o.id) }))
    toast(`Hidden: ${o.org} — ${o.post}`.slice(0, 70), { action: { label: 'Undo', onClick: undo(snap) } })
  }
  const del = (o: Opportunity) => {
    const snap = snapshot()
    jobsStore.set((s) => ({ ...s, deleted: [...(s.deleted ?? []), o.id], dismissed: s.dismissed.filter((x) => x !== o.id), applied: s.applied.filter((x) => x !== o.id) }))
    toast('Deleted from this device', { tone: 'danger', action: { label: 'Undo', onClick: undo(snap) } })
  }
  const restore = (o: Opportunity) => {
    jobsStore.set((s) => ({ ...s, dismissed: s.dismissed.filter((x) => x !== o.id), applied: s.applied.filter((x) => x !== o.id), deleted: (s.deleted ?? []).filter((x) => x !== o.id) }))
    toast(`Restored ${o.org}`)
  }
  const remind = (o: Opportunity) => {
    const ex = ensureTracked(o, 'to-apply')
    jobsStore.set((s) => ({ ...s, reminded: s.reminded.includes(o.id) ? s.reminded : [...s.reminded, o.id] }))
    const body = `Track this opening so email / Telegram / WhatsApp reminders cover it. The daily job reads the JSON below, adds it to exams.json and closes this issue.\n\n\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\``
    const url = `${REPO_ISSUES}?labels=track&title=${encodeURIComponent(`Track: ${o.org} — ${o.post}`.slice(0, 200))}&body=${encodeURIComponent(body)}`
    window.open(url, '_blank', 'noopener')
    toast('Opened a GitHub issue; submit it to get reminders', { tone: 'success' })
  }
  const untrack = (examId: string) => removeCustomExam(examId)
  const openInExams = (examId: string) => {
    navigate('exams')
    setTimeout(() => document.getElementById(`exam-${examId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }
  const trackedId = (o: Opportunity) => jobs.tracked[o.id] ?? (o.trackedExamId && exams.some((e) => e.id === o.trackedExamId) ? o.trackedExamId : undefined)

  return { all, jobs, prof, hidden, track, markApplied, dontWant, del, restore, remind, untrack, openInExams, trackedId, lastVisit: lastVisit.current }
}

export function markJobsVisited() {
  jobsStore.set((s: JobsState) => ({ ...s, lastVisit: new Date().toISOString() }))
}
