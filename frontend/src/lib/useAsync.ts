import { useCallback, useEffect, useRef, useState } from 'react'

interface AsyncState<T> {
  data: T | null
  /** True only while there is nothing to show yet. Drives skeletons. */
  loading: boolean
  /** True while a background refresh runs over data already on screen. */
  refreshing: boolean
  error: string | null
  reload: () => Promise<void>
  setData: (value: T) => void
}

/**
 * Minimal fetch-on-mount hook. Deliberately not a cache: balances change on
 * every write, so the pages reload the data they own after each mutation.
 *
 * Two things it does have to get right, because both are visible to the user:
 * a slow response for a group you have already navigated away from must never
 * overwrite the one you are looking at, and a refresh of data already on screen
 * must not blank it out.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fnRef = useRef(fn)
  fnRef.current = fn

  // Every call gets a ticket; only the latest one is allowed to write state.
  const ticket = useRef(0)
  const hasData = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    const mine = ++ticket.current
    if (hasData.current) setRefreshing(true)
    else setLoading(true)

    try {
      const result = await fnRef.current()
      if (mine !== ticket.current || !mounted.current) return
      setData(result)
      hasData.current = true
      setError(null)
    } catch (err) {
      if (mine !== ticket.current || !mounted.current) return
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      if (mine === ticket.current && mounted.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    // A new set of deps means the data on screen belongs to something else.
    hasData.current = false
    void reload()
  }, [reload])

  const replace = useCallback((value: T) => {
    hasData.current = true
    setData(value)
  }, [])

  return { data, loading, refreshing, error, reload, setData: replace }
}
