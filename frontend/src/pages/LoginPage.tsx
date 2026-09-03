import { useState } from 'react'
import { ArrowLeft, Loader2, MailCheck, Scale } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/auth/AuthProvider'
import {
  MIN_PASSWORD,
  PasswordInput,
  PasswordStrengthMeter,
} from '@/components/PasswordInput'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { looksLikeEmail } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import {
  authConfigured,
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
  supabase,
} from '@/lib/supabase'

type Mode = 'signin' | 'signup' | 'forgot'

const COPY: Record<Mode, { title: string; description: string; submit: string }> = {
  signin: {
    title: 'Welcome back',
    description: 'Sign in to see your groups and balances.',
    submit: 'Sign in',
  },
  signup: {
    title: 'Create your account',
    description: 'Share expenses with friends and settle up in as few payments as possible.',
    submit: 'Create account',
  },
  forgot: {
    title: 'Reset your password',
    description: 'We will email you a link to choose a new one.',
    submit: 'Send reset link',
  },
}

/** Long enough that a slow mail provider does not look like a broken button,
 *  short enough not to feel punitive. */
const RESEND_COOLDOWN = 30

export default function LoginPage() {
  const { error: authError } = useAuth()

  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  // Terminal states that replace the form entirely.
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null)
  const [resetSentTo, setResetSentTo] = useState<string | null>(null)

  useDocumentTitle(COPY[mode].title)

  function switchTo(next: Mode) {
    setMode(next)
    setPassword('')
    setProblem(null)
  }

  /** Everything that has to be true before the request is worth making, in the
   *  order the fields appear. Shown on submit rather than by killing the
   *  button, so there is always something to read. */
  function validate(): string | null {
    if (mode === 'signup' && !name.trim()) return 'What should we call you?'
    if (!looksLikeEmail(email)) return 'That does not look like an email address.'
    if (mode === 'forgot') return null
    if (!password) return 'Enter your password.'
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      return `Passwords need at least ${MIN_PASSWORD} characters.`
    }
    return null
  }

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN)
    const timer = setInterval(() => {
      setCooldown((current) => {
        if (current <= 1) {
          clearInterval(timer)
          return 0
        }
        return current - 1
      })
    }, 1000)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    const invalid = validate()
    if (invalid) {
      setProblem(invalid)
      return
    }

    setProblem(null)
    setBusy(true)
    // The auth listener replaces this whole screen after a successful sign-in.
    // Letting the button go idle first flashes a live form for a frame.
    let handOff = false
    try {
      if (mode === 'signin') {
        await signIn(email, password)
        handOff = true
        return
      }
      if (mode === 'signup') {
        const { needsConfirmation } = await signUp(email, password, name)
        if (needsConfirmation) {
          setConfirmationSentTo(email.trim().toLowerCase())
          startCooldown()
        }
      } else {
        await requestPasswordReset(email)
        setResetSentTo(email.trim().toLowerCase())
      }
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      if (!handOff) setBusy(false)
    }
  }

  async function resend() {
    if (!confirmationSentTo || cooldown > 0) return
    setBusy(true)
    try {
      await resendConfirmation(confirmationSentTo)
      toast.success('Sent again — check your inbox.')
      startCooldown()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resend the email')
    } finally {
      setBusy(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4 py-10">
      <div className="fixed top-3 right-3">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">{children}</Card>
    </div>
  )

  // ---- "check your inbox" states -----------------------------------------
  if (confirmationSentTo || resetSentTo) {
    const address = confirmationSentTo ?? resetSentTo
    const isConfirmation = Boolean(confirmationSentTo)

    return shell(
      <>
        <CardHeader className="items-center text-center">
          <span className="mx-auto mb-2 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <MailCheck className="size-5" aria-hidden />
          </span>
          <CardTitle className="text-xl">Check your inbox</CardTitle>
          <CardDescription>
            {isConfirmation
              ? 'If that address is not already registered, a confirmation link is on its way to '
              : 'If an account exists for that address, a reset link is on its way to '}
            <span className="font-medium break-all text-foreground">{address}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            The link opens this app and signs you in. It can take a minute to
            arrive, and it sometimes lands in spam.
          </p>
          {isConfirmation ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void resend()}
              disabled={busy || cooldown > 0}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {cooldown > 0 ? `Send it again in ${cooldown}s` : 'Send it again'}
            </Button>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setConfirmationSentTo(null)
              setResetSentTo(null)
              switchTo('signin')
            }}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to sign in
          </Button>
        </CardFooter>
      </>,
    )
  }

  // ---- the form -----------------------------------------------------------
  const copy = COPY[mode]

  return shell(
    <form onSubmit={submit} noValidate>
      <CardHeader className="items-center text-center">
        <span className="mx-auto mb-2 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Scale className="size-5" aria-hidden />
        </span>
        <CardTitle className="text-xl">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {mode === 'signup' ? (
          <div className="grid gap-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Renato"
              autoComplete="name"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              This is what the people in your groups will see.
            </p>
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            // Phones capitalise and autocorrect the first word of a field by
            // default, which quietly mangles email addresses.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            autoFocus={mode !== 'signup'}
          />
        </div>

        {mode !== 'forgot' ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              {mode === 'signin' ? (
                <button
                  type="button"
                  className="rounded text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => switchTo('forgot')}
                >
                  Forgot password?
                </button>
              ) : null}
            </div>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
            {mode === 'signup' ? <PasswordStrengthMeter password={password} /> : null}
          </div>
        ) : null}

        {problem ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            {problem}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy || !supabase}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {copy.submit}
        </Button>

        {!authConfigured ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Auth is not configured yet. Copy <code>frontend/.env.example</code> to{' '}
            <code>.env.local</code> and fill in your Supabase project, or set{' '}
            <code>VITE_AUTH_DEV_EMAIL</code> to work offline.
          </p>
        ) : null}

        {authError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            {authError}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="justify-center text-sm text-muted-foreground">
        {mode === 'signin' ? (
          <span>
            No account yet?{' '}
            <button
              type="button"
              className="rounded font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => switchTo('signup')}
            >
              Create one
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => switchTo('signin')}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back to sign in
          </button>
        )}
      </CardFooter>
    </form>,
  )
}
