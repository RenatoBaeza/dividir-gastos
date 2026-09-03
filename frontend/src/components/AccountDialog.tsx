import { useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/auth/AuthProvider'
import {
  MIN_PASSWORD,
  PasswordInput,
  PasswordStrengthMeter,
} from '@/components/PasswordInput'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { submitOnMetaEnter } from '@/lib/useHotkey'
import { devEmail, updatePassword } from '@/lib/supabase'
import type { User } from '@/types'

export function AccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so the fields always start from the
            current profile without an effect to reset them. */}
        {open && user ? (
          <AccountForm user={user} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AccountForm({ user, onDone }: { user: User; onDone: () => void }) {
  const { refreshUser } = useAuth()
  const [displayName, setDisplayName] = useState(user.display_name)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const nameChanged = displayName.trim() !== user.display_name && displayName.trim() !== ''
  const wantsNewPassword = password.length > 0 || confirmation.length > 0
  const mismatch = confirmation.length > 0 && confirmation !== password
  const nothingToDo = !nameChanged && !wantsNewPassword

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    if (nothingToDo) {
      setProblem('Change your name or set a new password first.')
      return
    }
    if (wantsNewPassword && password.length < MIN_PASSWORD) {
      setProblem(`Passwords need at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (wantsNewPassword && password !== confirmation) {
      setProblem('The two passwords do not match.')
      return
    }

    setProblem(null)
    setBusy(true)
    try {
      if (nameChanged) {
        await api.updateMe(displayName.trim())
        await refreshUser()
      }
      if (wantsNewPassword) await updatePassword(password)
      toast.success(
        wantsNewPassword && nameChanged
          ? 'Name and password updated'
          : wantsNewPassword
            ? 'Password updated'
            : 'Name updated',
      )
      onDone()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not update your account')
    } finally {
      setBusy(false)
    }
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(user.email)
      toast.success('Email copied')
    } catch {
      toast.error('Your browser would not let us copy that.')
    }
  }

  return (
    <form onSubmit={submit} onKeyDown={submitOnMetaEnter} noValidate>
      <DialogHeader>
        <DialogTitle>Account</DialogTitle>
        <DialogDescription>
          Your name is what the people in your groups see.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="account-email">Email</Label>
          <div className="flex gap-2">
            <Input id="account-email" value={user.email} readOnly className="flex-1" />
            {/* People need this address to invite themselves elsewhere, and a
                disabled field cannot even be selected on some browsers. */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => void copyEmail()}
                    aria-label="Copy your email address"
                  />
                }
              >
                <Copy className="size-4" aria-hidden />
              </TooltipTrigger>
              <TooltipContent>Copy your email address</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground">
            The address people use to invite you. It cannot be changed here.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="account-name">Display name</Label>
          <Input
            id="account-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
          />
        </div>

        {devEmail ? null : (
          <>
            <Separator />
            <p className="text-sm font-medium">Change password</p>

            <div className="grid gap-2">
              <Label htmlFor="account-password">New password</Label>
              <PasswordInput
                id="account-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Leave blank to keep your current one"
              />
              {password ? <PasswordStrengthMeter password={password} /> : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="account-confirm">Confirm new password</Label>
              <PasswordInput
                id="account-confirm"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                aria-invalid={mismatch ? true : undefined}
              />
              {mismatch ? (
                <p className="text-xs text-destructive">The two passwords do not match.</p>
              ) : null}
            </div>
          </>
        )}

        {problem ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            {problem}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
