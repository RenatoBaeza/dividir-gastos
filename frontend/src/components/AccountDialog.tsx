import { useState } from 'react'
import { toast } from 'sonner'

import { useAuth } from '@/auth/AuthProvider'
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
import { api } from '@/lib/api'
import { devEmail, updatePassword } from '@/lib/supabase'
import type { User } from '@/types'

const MIN_PASSWORD = 8

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

  const nameChanged = displayName.trim() !== user.display_name && displayName.trim() !== ''
  const wantsNewPassword = password.length > 0 || confirmation.length > 0
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirmation.length > 0 && confirmation !== password

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      if (nameChanged) {
        await api.updateMe(displayName.trim())
        await refreshUser()
      }
      if (wantsNewPassword) await updatePassword(password)
      toast.success('Account updated')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update your account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Account</DialogTitle>
        <DialogDescription>
          Your name is what the people in your groups see.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="account-email">Email</Label>
          <Input id="account-email" value={user.email} disabled />
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
              <Input
                id="account-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Leave blank to keep your current one"
              />
              {tooShort ? (
                <p className="text-xs text-destructive">
                  At least {MIN_PASSWORD} characters.
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="account-confirm">Confirm new password</Label>
              <Input
                id="account-confirm"
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
              />
              {mismatch ? (
                <p className="text-xs text-destructive">
                  The two passwords do not match.
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            busy ||
            tooShort ||
            mismatch ||
            (wantsNewPassword && confirmation.length === 0) ||
            (!nameChanged && !wantsNewPassword)
          }
        >
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
