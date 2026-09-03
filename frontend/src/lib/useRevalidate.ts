import { useEffect, useRef } from 'react'

const STALE_AFTER = 30_000

/**
 * Balances are shared state: someone else can add an expense while this tab
 * sits open. Coming back to the tab is the moment a person expects to see the
 * truth, so that is when we refetch — but only if enough time has passed that
 * the data could plausibly have changed.
 */
export function useRevalidateOnFocus(reload: () => void, enabled = true) {
  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  })

  const lastRun = useRef(0)

  useEffect(() => {
    if (!enabled) return
    // The data has just been fetched by whoever mounted us; the clock starts now.
    lastRun.current = Date.now()

    function maybeReload() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRun.current < STALE_AFTER) return
      lastRun.current = Date.now()
      reloadRef.current()
    }

    document.addEventListener('visibilitychange', maybeReload)
    window.addEventListener('focus', maybeReload)
    return () => {
      document.removeEventListener('visibilitychange', maybeReload)
      window.removeEventListener('focus', maybeReload)
    }
  }, [enabled])
}
