import { forwardRef } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Everything that is not a digit or a single separator, plus a normalised
 *  comma — a European keyboard types "12,50" and means 12.50. */
function sanitize(raw: string): string {
  const cleaned = raw.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  const decimals = rest.join('').slice(0, 2)
  return rest.length ? `${whole}.${decimals}` : whole
}

interface Props extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'> {
  value: string
  onValueChange: (value: string) => void
  /** Rendered inside the field so the number is never ambiguous. */
  currency?: string
}

/**
 * A money field that cannot hold something that is not money. Typing letters
 * into a free-text amount used to leave a silently-zero value and a submit
 * button that refused to work with no explanation; here the character simply
 * never lands.
 */
export const AmountInput = forwardRef<HTMLInputElement, Props>(function AmountInput(
  { value, onValueChange, currency, className, ...props },
  ref,
) {
  return (
    <div className="relative flex-1">
      {currency ? (
        <span
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
          aria-hidden
        >
          {currency}
        </span>
      ) : null}
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        // A real number input would let the wheel change the amount by accident.
        type="text"
        value={value}
        onChange={(event) => onValueChange(sanitize(event.target.value))}
        // Editing an amount almost always means replacing it, not appending.
        onFocus={(event) => event.target.select()}
        className={cn('tabular-nums', currency && 'pl-12', className)}
        {...props}
      />
    </div>
  )
})
