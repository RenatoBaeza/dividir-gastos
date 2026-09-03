import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { updatePassword } from '@/lib/supabase'

/** Shown when the session came in through a password-reset link. */
export default function UpdatePasswordPage() {
  const { endPasswordRecovery, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useDocumentTitle('Choose a new password')

  const mismatch = confirmation.length > 0 && confirmation !== password

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    if (password.length < MIN_PASSWORD) {
      setProblem(`Passwords need at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirmation) {
      setProblem('The two passwords do not match.')
      return
    }

    setProblem(null)
    setBusy(true)
    try {
      await updatePassword(password)
      toast.success('Password updated. You are signed in.')
      endPasswordRecovery()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not update the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4 py-10">
      <div className="fixed top-3 right-3">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <form onSubmit={submit} noValidate>
          <CardHeader className="items-center text-center">
            <span className="mx-auto mb-2 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="size-5" aria-hidden />
            </span>
            <CardTitle className="text-xl">Choose a new password</CardTitle>
            <CardDescription>
              You are signed in from the reset link. Pick a password to finish.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="new-password">New password</Label>
              <PasswordInput
                id="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
              <PasswordStrengthMeter password={password} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <PasswordInput
                id="confirm-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                aria-invalid={mismatch ? true : undefined}
              />
              {mismatch ? (
                <p className="text-xs text-destructive">The two passwords do not match.</p>
              ) : null}
            </div>

            {problem ? (
              <p role="alert" className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                {problem}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Update password
            </Button>
          </CardContent>

          <CardFooter>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => void signOut()}
              disabled={busy}
            >
              Cancel and sign out
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
