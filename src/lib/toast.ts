import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  message: string
  action?: { label: string; onClick: () => void }
  tone?: 'default' | 'success' | 'danger'
  leaving?: boolean
}

let toasts: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()
const timers = new Map<number, number>()

function emit() {
  listeners.forEach((l) => l())
}

export function dismissToast(id: number) {
  const t = toasts.find((x) => x.id === id)
  if (!t || t.leaving) return
  toasts = toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x))
  emit()
  window.clearTimeout(timers.get(id))
  window.setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id)
    emit()
  }, 180)
}

/** Show a short status message, optionally with one action (typically Undo). */
export function toast(message: string, opts: { action?: Toast['action']; tone?: Toast['tone']; duration?: number } = {}) {
  const id = ++seq
  toasts = [...toasts.slice(-2), { id, message, action: opts.action, tone: opts.tone ?? 'default' }]
  emit()
  try {
    navigator.vibrate?.(6)
  } catch {
    /* unsupported */
  }
  timers.set(id, window.setTimeout(() => dismissToast(id), opts.duration ?? (opts.action ? 6000 : 3200)))
  return id
}

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => toasts,
    () => toasts,
  )
}
