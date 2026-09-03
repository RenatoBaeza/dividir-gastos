import { formatMoney, num } from '@/lib/format'
import { cn } from '@/lib/utils'

export type Direction = 'positive' | 'negative' | 'neutral'

export function directionOf(amount: string | number): Direction {
  const value = num(amount)
  // Sub-cent noise from currency conversion should read as "settled", not as a
  // debt of zero-point-nothing.
  if (Math.abs(value) < 0.005) return 'neutral'
  return value > 0 ? 'positive' : 'negative'
}

/**
 * emerald-600/rose-600 sit around 3.5:1 on white — under the 4.5:1 that normal
 * text needs. The 700 shades clear it, and the 400s clear it on the dark
 * background.
 */
export const TONE: Record<Direction, string> = {
  positive: 'text-emerald-700 dark:text-emerald-400',
  negative: 'text-rose-700 dark:text-rose-400',
  neutral: 'text-muted-foreground',
}

/**
 * An amount whose direction matters. Colour carries it for most people, but
 * colour is never the only channel: there is always a sign and a word, because
 * roughly one man in twelve cannot tell this particular green from this red.
 */
export function MoneyDelta({
  amount,
  currency,
  /** "you are owed" / "you owe", or the third-person equivalent. */
  labels = ['you are owed', 'you owe', 'settled up'],
  showLabel = false,
  className,
  labelClassName,
}: {
  amount: string | number
  currency: string
  labels?: [string, string, string]
  showLabel?: boolean
  className?: string
  labelClassName?: string
}) {
  const direction = directionOf(amount)
  const value = num(amount)
  const [owedLabel, owesLabel, squareLabel] = labels
  const label =
    direction === 'positive' ? owedLabel : direction === 'negative' ? owesLabel : squareLabel

  if (direction === 'neutral') {
    return (
      <span className={cn('font-medium tabular-nums', TONE.neutral, className)}>
        {showLabel ? squareLabel : '—'}
      </span>
    )
  }

  return (
    <span className={cn('font-medium tabular-nums', TONE[direction], className)}>
      {showLabel ? (
        <span className={cn('mr-1 text-xs font-normal', labelClassName)}>{label}</span>
      ) : null}
      {/* Sign and amount stay one unit so a column layout cannot break them
          onto separate lines. */}
      <span>
        <span aria-hidden>{direction === 'positive' ? '+' : '−'}</span>
        <span className="sr-only">{label} </span>
        {formatMoney(Math.abs(value), currency)}
      </span>
    </span>
  )
}
