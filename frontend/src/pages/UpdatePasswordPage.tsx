import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
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
import { updatePassword } from '@/lib/supabase'

const MIN_PASSWORD = 8

/** Shown when the session came in through a password-reset link. */
export default function UpdatePasswordPage() {
  const { endPasswordRecovery, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirmation.length > 0 && confirmation !== password

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await updatePassword(password)
      toast.success('Password updated')
      endPasswordRecovery()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <form onSubmit={submit}>
          <CardHeader className="items-center text-center">
            <span className="mb-2 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
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
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
                autoFocus
              />
              <p
                className={tooShort ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
              >
                At least {MIN_PASSWORD} characters.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                required
              />
              {mismatch ? (
                <p className="text-xs text-destructive">The two passwords do not match.</p>
              ) : null}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={busy || tooShort || mismatch || password.length === 0 || confirmation.length === 0}
            >
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
