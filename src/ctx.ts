import { createContext, useContext } from 'react'
import type { CalEvent, Exam, ExamOverride, PhaseOverride, RepoDoc, ScrapeStatusFile, UpdatesFile } from './types'

export interface AppState {
  exams: Exam[]
  events: CalEvent[]
  updates: UpdatesFile
  status: ScrapeStatusFile
  documents: RepoDoc[]
  overrides: Record<string, ExamOverride>
  generatedAt: string
  docCounts: Record<string, number>
  refreshDocCounts: () => void
  setOverride: (examId: string, patch: Partial<ExamOverride>) => void
  setPhase: (examId: string, phaseId: string, patch: PhaseOverride) => void
  addCustomExam: (exam: Exam) => void
  removeCustomExam: (id: string) => void
  navigate: (view: string) => void
}

export const AppCtx = createContext<AppState | null>(null)
export function useApp() {
  const v = useContext(AppCtx)
  if (!v) throw new Error('AppCtx missing')
  return v
}
