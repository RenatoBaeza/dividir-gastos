import { cn } from '@/lib/utils'

/**
 * A key cap. `data-slot="kbd"` is what the tooltip styles against, and the
 * colours are drawn from the surface it sits on rather than the page, so it
 * stays legible inside an inverted tooltip.
 */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-grid min-w-5 place-items-center rounded border border-current/25 bg-current/15 px-1 py-0.5 font-sans text-[10px] font-medium',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
