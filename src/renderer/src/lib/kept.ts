import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * useState that outlives the screen: switching tabs and coming back keeps the value, and work
 * started on an earlier visit (a link check, a channel listing) still lands. Keys are app-wide.
 */
const kept = new Map<string, unknown>()
/** The open screen's setters per key; work started on an earlier visit updates the screen shown now. */
const shown = new Map<string, Set<(value: unknown) => void>>()

export function useKept<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : initial))
  useEffect(() => {
    const listeners = shown.get(key) ?? new Set()
    shown.set(key, listeners)
    const listener = setValue as (value: unknown) => void
    listeners.add(listener)
    // Anything that landed between the first render and now.
    if (kept.has(key)) setValue(kept.get(key) as T)
    return () => {
      listeners.delete(listener)
    }
  }, [key])
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const current = (kept.has(key) ? kept.get(key) : initial) as T
      const value = typeof next === 'function' ? (next as (old: T) => T)(current) : next
      kept.set(key, value)
      for (const listener of shown.get(key) ?? []) listener(value)
    },
    // `initial` is only the first value; later ones are ignored, as with useState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  return [value, set]
}
