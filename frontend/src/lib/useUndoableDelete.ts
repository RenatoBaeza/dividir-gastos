import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const GRACE_MS = 6000

interface Options {
  /** The request that actually deletes it. Fired once the grace period ends. */
  perform: (id: string) => Promise<unknown>
  /** Toast copy, e.g. `Deleted "Dinner at Cantina"`. */
  describe: (id: string) => string
  /** Called after a delete really goes through, to refresh whatever it changed. */
  onDone: () => void
}

/**
 * Deleting an expense is the one move in this app that quietly rewrites what
 * everybody else owes, and there is no API to bring one back. So the delete is
 * held for a few seconds behind an Undo instead of behind a second
 * "are you sure?" — the row disappears at once, which is the feedback people
 * want, and the mistake is one click to reverse rather than impossible.
 *
 * Leaving the page flushes anything still waiting: a delete that only happened
 * if you stayed put would be worse than no undo at all.
 */
export function useUndoableDelete({ perform, describe, onDone }: Options) {
  const [pending, setPending] = useState<string[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // The callbacks arrive as fresh closures on every render. Held in refs so the
  // flush-on-unmount effect below runs exactly once, at unmount — keying it on
  // the callbacks instead would fire the queue on the very next render and
  // there would be nothing left to undo.
  const performRef = useRef(perform)
  const describeRef = useRef(describe)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    performRef.current = perform
    describeRef.current = describe
    onDoneRef.current = onDone
  })

  const commit = useCallback(async (id: string) => {
    timers.current.delete(id)
    try {
      await performRef.current(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that')
    } finally {
      setPending((current) => current.filter((value) => value !== id))
      onDoneRef.current()
    }
  }, [])

  useEffect(() => {
    const queue = timers.current
    return () => {
      // Unmounting means navigating away. Send everything still in the queue.
      for (const [id, timer] of queue) {
        clearTimeout(timer)
        void performRef.current(id).catch(() => undefined)
      }
      queue.clear()
    }
  }, [])

  const remove = useCallback(
    (id: string) => {
      setPending((current) => [...current, id])
      timers.current.set(
        id,
        setTimeout(() => void commit(id), GRACE_MS),
      )

      toast(describeRef.current(id), {
        duration: GRACE_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            const timer = timers.current.get(id)
            if (!timer) return
            clearTimeout(timer)
            timers.current.delete(id)
            setPending((current) => current.filter((value) => value !== id))
            toast.success('Restored')
          },
        },
      })
    },
    [commit],
  )

  const isPending = useCallback((id: string) => pending.includes(id), [pending])

  return { remove, isPending, pendingCount: pending.length }
}
