import { useLayoutEffect, useState } from 'react'

/**
 * Returns 'is-pre' for the first painted frame after `deps` change, then ''.
 * Children styled under `.is-pre` start hidden and transition in once the class drops.
 * Unlike @starting-style this never re-runs on viewport resizes.
 */
export function useEntrance(deps: unknown[] = []): string {
  const [pre, setPre] = useState(true)
  useLayoutEffect(() => {
    setPre(true)
    let id2 = 0
    const id = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setPre(false))
    })
    return () => {
      cancelAnimationFrame(id)
      cancelAnimationFrame(id2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return pre ? 'is-pre' : ''
}
