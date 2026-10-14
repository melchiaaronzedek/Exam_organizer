import { useSyncExternalStore } from 'react'

type Listener = () => void

/** Tiny persisted store: JSON in localStorage, subscribable with a React hook. */
export function createStore<T>(key: string, initial: T) {
  let value: T = read()
  const listeners = new Set<Listener>()

  function read(): T {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return initial
      return { ...initial, ...(JSON.parse(raw) as T) }
    } catch {
      return initial
    }
  }

  function write(next: T) {
    value = next
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* private mode or quota: keep in memory only */
    }
    listeners.forEach((l) => l())
  }

  return {
    get: () => value,
    set: (next: T | ((prev: T) => T)) => {
      write(typeof next === 'function' ? (next as (p: T) => T)(value) : next)
    },
    subscribe: (l: Listener) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    use: () => useSyncExternalStore((l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }, () => value, () => value),
    key,
  }
}

import type { Exam, ExamOverride, Prefs } from '../types'

export const overridesStore = createStore<Record<string, ExamOverride>>('pd.overrides', {})
export const customExamsStore = createStore<{ list: Exam[] }>('pd.custom', { list: [] })
export const seenStore = createStore<{ ids: string[] }>('pd.seen', { ids: [] })
export const prefsStore = createStore<Prefs>('pd.prefs', {
  theme: 'ink',
  leadDays: [7, 3, 1, 0],
  notifications: false,
})

export function exportLocalState() {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      overrides: overridesStore.get(),
      custom: customExamsStore.get(),
      seen: seenStore.get(),
      prefs: prefsStore.get(),
    },
    null,
    2,
  )
}

export function importLocalState(json: string) {
  const data = JSON.parse(json) as Partial<{
    overrides: Record<string, ExamOverride>
    custom: { list: Exam[] }
    seen: { ids: string[] }
    prefs: Prefs
  }>
  if (data.overrides) overridesStore.set(data.overrides)
  if (data.custom) customExamsStore.set(data.custom)
  if (data.seen) seenStore.set(data.seen)
  if (data.prefs) prefsStore.set(data.prefs)
}

export interface JobsState {
  dismissed: string[]
  tracked: Record<string, string> // opportunityId -> examId
}
export const jobsStore = createStore<JobsState>('pd.jobs', { dismissed: [], tracked: {} })

export interface ProfileOverride {
  roles?: string[]
  cities?: string[]
  minPayLakh?: number
  southFirst?: boolean
}
export const profileStore = createStore<ProfileOverride>('pd.profile', {})
