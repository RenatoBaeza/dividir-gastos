import { formatMoney, num } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Green when the group owes you, red when you owe, muted when square. */
export function NetBadge({
  amount,
  currency,
  className,
  showLabel = false,
}: {
  amount: string
  currency: string
  className?: string
  showLabel?: boolean
}) {
  const value = num(amount)
  const tone =
    value > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : value < 0
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-muted-foreground'

  const label = value > 0 ? 'you are owed' : value < 0 ? 'you owe' : 'settled up'

  return (
    <span className={cn('tabular-nums font-medium', tone, className)}>
      {showLabel ? <span className="mr-1 text-xs font-normal">{label}</span> : null}
      {value === 0 && showLabel ? null : formatMoney(amount, currency)}
    </span>
  )
}
