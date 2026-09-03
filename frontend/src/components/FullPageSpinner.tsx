import { Loader2 } from 'lucide-react'

export function FullPageSpinner({
  label = 'Loading…',
  full = false,
}: {
  label?: string
  /** Fills the viewport, for the boot screen that has no layout around it. */
  full?: boolean
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        full
          ? 'flex min-h-screen items-center justify-center gap-3 text-muted-foreground'
          : 'flex min-h-[60vh] items-center justify-center gap-3 text-muted-foreground'
      }
    >
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  )
}
