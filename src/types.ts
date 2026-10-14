export type DateType = 'confirmed' | 'tentative' | 'tba'
export type PhaseKind = 'application' | 'admit-card' | 'exam' | 'result' | 'interview' | 'other'
export type PhaseStatus = 'done' | 'upcoming' | 'tba'
export type ExamStatus = 'to-apply' | 'applied' | 'written' | 'result-awaited' | 'closed'

export interface Centre {
  preferences: string[]
  allotted?: string | null
}

export interface Phase {
  id: string
  name: string
  kind: PhaseKind
  date?: string
  dateEnd?: string
  dateType: DateType
  timeNote?: string
  status: PhaseStatus
  centre?: Centre
  sourceUrl?: string
  note?: string
}

export interface Application {
  opens?: string
  closes?: string
  mode?: 'online' | 'offline'
  fee?: string
  applied?: boolean
  appliedOn?: string
  note?: string
}

export interface Exam {
  id: string
  org: string
  short: string
  title: string
  post: string
  advt?: string
  status: ExamStatus
  officialUrl: string
  notificationUrl?: string
  applyUrl?: string
  application: Application
  phases: Phase[]
  notes?: string[]
  custom?: boolean
}

export interface ExamsFile {
  generatedAt: string
  candidateRegion?: string
  exams: Exam[]
}

export interface Update {
  id: string
  examId: string
  title: string
  url: string
  source: string
  publishedAt?: string | null
  firstSeen: string
}

export interface UpdatesFile {
  updatedAt: string | null
  updates: Update[]
}

export interface SourceStatus {
  name: string
  examId: string
  url: string
  ok: boolean
  error?: string | null
  items: number
  checkedAt: string
}

export interface ScrapeStatusFile {
  lastRun: string | null
  sources: SourceStatus[]
}

export interface PhaseOverride {
  date?: string
  dateType?: DateType
  status?: PhaseStatus
  allotted?: string | null
  venue?: string
  note?: string
}

export interface ExamOverride {
  status?: ExamStatus
  applied?: boolean
  appliedOn?: string
  notes?: string
  regNo?: string
  phases?: Record<string, PhaseOverride>
}

export interface Prefs {
  theme: 'ink' | 'paper'
  leadDays: number[]
  notifications: boolean
  name?: string
  category?: string
  lastNotifyDay?: string
}

/** A single dated thing on the calendar: a phase date or an application deadline. */
export interface CalEvent {
  id: string
  examId: string
  examShort: string
  examTitle: string
  phaseId: string
  label: string
  kind: PhaseKind
  date: string
  dateEnd?: string
  dateType: DateType
  centre?: string | null
  centrePrefs?: string[]
  venue?: string
  timeNote?: string
  status: PhaseStatus
  examStatus: ExamStatus
}
