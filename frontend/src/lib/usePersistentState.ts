import { useCallback, useEffect, useState } from 'react'

/**
 * A preference the person set once and should not have to set again — the
 * settle-up view, a collapsed section. Never anything that must be reliable:
 * private windows and cleared site data both return nothing.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return stored === null ? initial : (JSON.parse(stored) as T)
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Storage disabled or full. The preference just does not survive.
    }
  }, [key, value])

  return [value, useCallback((next) => setValue(next), [])]
}
