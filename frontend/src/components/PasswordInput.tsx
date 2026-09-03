import { useId, useState } from 'react'
import { Eye, EyeOff, TriangleAlert } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export const MIN_PASSWORD = 8

/**
 * Password fields hide the one thing the person needs to check, and the most
 * common reason a correct password is rejected is a caps-lock key nobody
 * looked at. Both are cheap to fix and both cost real sign-ins.
 */
export function PasswordInput({
  className,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const hintId = useId()

  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <Input
          {...props}
          type={visible ? 'text' : 'password'}
          onChange={onChange}
          aria-describedby={capsLock ? hintId : props['aria-describedby']}
          onKeyUp={(event) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
          onBlur={(event) => {
            setCapsLock(false)
            props.onBlur?.(event)
          }}
          className={cn('pr-10', className)}
        />
        <button
          type="button"
          // Not in the tab order: it is a convenience, and stopping between the
          // password field and the submit button on every form is not.
          tabIndex={-1}
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
      {capsLock ? (
        <p id={hintId} className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-500">
          <TriangleAlert className="size-3.5" aria-hidden />
          Caps Lock is on.
        </p>
      ) : null}
    </div>
  )
}

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
  hint: string
}

/**
 * Length dominates real password strength, so that is what this weighs. It is
 * guidance, not a gate: the only hard rule is the minimum length, and a long
 * passphrase of one character class scores well, as it should.
 */
export function passwordStrength(password: string): Strength {
  if (!password) return { score: 0, label: '', hint: `At least ${MIN_PASSWORD} characters.` }
  if (password.length < MIN_PASSWORD) {
    return {
      score: 0,
      label: 'Too short',
      hint: `${MIN_PASSWORD - password.length} more character${
        MIN_PASSWORD - password.length === 1 ? '' : 's'
      } to go.`,
    }
  }

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((re) => re.test(password)).length
  let score = 1
  if (password.length >= 12) score += 1
  if (password.length >= 16) score += 1
  if (classes >= 3) score += 1

  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']
  const capped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4
  return {
    score: capped,
    label: labels[capped],
    hint:
      capped <= 2
        ? 'Longer beats more complicated — three or four unrelated words works well.'
        : 'That will do nicely.',
  }
}

const BAR_TONES = [
  'bg-muted',
  'bg-rose-600',
  'bg-amber-500',
  'bg-emerald-600',
  'bg-emerald-600',
]

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { score, label, hint } = passwordStrength(password)

  return (
    <div className="grid gap-1.5">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              step <= score ? BAR_TONES[score] : 'bg-muted',
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {label ? <span className="font-medium text-foreground">{label}. </span> : null}
        {hint}
      </p>
    </div>
  )
}
