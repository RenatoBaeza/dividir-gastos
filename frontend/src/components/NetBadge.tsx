import { MoneyDelta } from '@/components/MoneyDelta'

/** Your own position in a group: green when you are owed, red when you owe. */
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
  return (
    <MoneyDelta
      amount={amount}
      currency={currency}
      className={className}
      showLabel={showLabel}
      labels={['you are owed', 'you owe', 'settled up']}
    />
  )
}
