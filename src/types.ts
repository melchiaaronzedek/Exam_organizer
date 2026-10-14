export type DateType = 'confirmed' | 'tentative' | 'tba'
export type PhaseKind = 'application' | 'admit-card' | 'exam' | 'result' | 'interview' | 'other'
export type PhaseStatus = 'done' | 'upcoming' | 'tba'
export type ExamStatus = 'to-apply' | 'applied' | 'written' | 'result-awaited' | 'closed'

export interface Centre {
  preferences: string[]
  allotted?: string | null
  venue?: string
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

export interface Facts {
  vacancies?: string
  age?: string
  fee?: string
  pattern?: string
  selection?: string
  pay?: string
  carry?: string[]
}

export interface RepoDoc {
  examId: string
  type: string
  name: string
  file: string
  url: string
  size: number
  ext: string
}

export interface DocumentsFile {
  count: number
  documents: RepoDoc[]
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
  facts?: Facts
  postingPreferences?: string[]
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
  via?: string | null
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
  checklist?: string[]
  phases?: Record<string, PhaseOverride>
}

export interface Prefs {
  theme: 'ink' | 'paper'
  leadDays: number[]
  notifications: boolean
  name?: string
  category?: string
  lastNotifyDay?: string
  trackRange?: 30 | 75 | 120
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

export interface Profile {
  name?: string
  headline: string
  education: string[]
  experience?: string[]
  ageOn: string
  qualifications: string[]
  roles: string[]
  sectors: string[]
  excludeTerms: string[]
  homeStates: string[]
  cities: string[]
  minPayLakh: number
  maxExperienceYears?: number
  privateMinPayLakh?: number
  privatePayFloorLakh?: number
}

export type OppTrack = 'marketing' | 'general' | 'agri' | 'state' | 'private'
export type OppStatus = 'open' | 'expected' | 'closed'

export interface Opportunity {
  id: string
  org: string
  post: string
  title?: string
  sector: string
  track: OppTrack
  state?: string
  eligibility?: string
  ageMax?: number | null
  vacancies?: string | number | null
  pay?: string | null
  payLakh?: number | null
  applyOpens?: string | null
  applyCloses?: string | null
  examDate?: string | null
  examDateType?: DateType
  typicalWindow?: string
  expectedMonth?: string | null
  lastCycle?: string
  mbaRelevance?: string
  agriRelevance?: string
  locations?: string[]
  link: string
  source?: string
  sourceType: 'official' | 'news' | 'aggregator' | 'portal'
  kind?: 'portal'
  payMinLakh?: number | null
  payMaxLakh?: number | null
  experienceText?: string
  experienceMinYears?: number | null
  postedAt?: string | null
  lastSeen?: string
  trust?: 'verified' | 'unverified'
  payStated?: boolean
  checked?: boolean
  website?: string | null
  summary?: string | null
  fit?: number
  fitWhy?: string[]
  status: OppStatus
  publishedAt?: string | null
  firstSeen?: string
  curated?: boolean
  trackedExamId?: string
  note?: string
}

export interface OpportunitiesFile {
  curatedAt?: string
  discoveredAt?: string
  discoverBaseline?: boolean
  portalAt?: string
  portalBaseline?: boolean
  portalStatus?: { name: string; ok: boolean; scanned?: number; fetched?: number; errors?: number; error?: string | null; state?: 'ok' | 'partial' | 'empty' | 'blocked' | 'error' | 'off'; reason?: string | null }[]
  curated: Opportunity[]
  discovered: Opportunity[]
  portal?: Opportunity[]
}
