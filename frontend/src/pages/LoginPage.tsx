import { useState } from 'react'
import { ArrowLeft, Loader2, MailCheck, Scale } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/auth/AuthProvider'
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
import {
  authConfigured,
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
  supabase,
} from '@/lib/supabase'

type Mode = 'signin' | 'signup' | 'forgot'

const MIN_PASSWORD = 8

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

export default function LoginPage() {
  const { error: authError } = useAuth()

  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  // Terminal states that replace the form entirely.
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null)
  const [resetSentTo, setResetSentTo] = useState<string | null>(null)

  function switchTo(next: Mode) {
    setMode(next)
    setPassword('')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
        // The auth listener picks it up from here and swaps in the app.
      } else if (mode === 'signup') {
        const { needsConfirmation } = await signUp(email, password, name)
        if (needsConfirmation) setConfirmationSentTo(email.trim().toLowerCase())
      } else {
        await requestPasswordReset(email)
        setResetSentTo(email.trim().toLowerCase())
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    if (!confirmationSentTo) return
    setBusy(true)
    try {
      await resendConfirmation(confirmationSentTo)
      toast.success('Sent again — check your inbox.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resend the email')
    } finally {
      setBusy(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4">
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
          <span className="mb-2 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <MailCheck className="size-5" aria-hidden />
          </span>
          <CardTitle className="text-xl">Check your inbox</CardTitle>
          <CardDescription>
            {isConfirmation
              ? 'If that address is not already registered, a confirmation link is on its way to '
              : 'If an account exists for that address, a reset link is on its way to '}
            <span className="font-medium text-foreground">{address}</span>.
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
              disabled={busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Send it again
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
  const passwordTooShort = mode === 'signup' && password.length > 0 && password.length < MIN_PASSWORD
  const canSubmit =
    !busy &&
    Boolean(supabase) &&
    email.trim().length > 0 &&
    (mode === 'forgot' || password.length >= (mode === 'signup' ? MIN_PASSWORD : 1)) &&
    (mode !== 'signup' || name.trim().length > 0)

  return shell(
    <form onSubmit={submit}>
      <CardHeader className="items-center text-center">
        <span className="mb-2 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
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
              required
            />
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
            required
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
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => switchTo('forgot')}
                >
                  Forgot password?
                </button>
              ) : null}
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
            />
            {mode === 'signup' ? (
              <p
                className={
                  passwordTooShort ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
                }
              >
                At least {MIN_PASSWORD} characters.
              </p>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={!canSubmit}>
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
          <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
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
              className="font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => switchTo('signup')}
            >
              Create one
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
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
