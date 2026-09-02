import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Plus, Users, X } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/auth/AuthProvider'
import { ImportSplitwiseDialog } from '@/components/ImportSplitwiseDialog'
import { NetBadge } from '@/components/NetBadge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { CURRENCIES, formatMoney } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'

function CreateGroupDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await api.createGroup({ name, description, base_currency: currency })
      toast.success(`Created “${name}”`)
      setOpen(false)
      setName('')
      setDescription('')
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the group')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" aria-hidden />
        New group
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>
              A trip, a flat, a family — anything with a shared pot of money.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lisbon 2026"
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-description">Description</Label>
              <Textarea
                id="group-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                rows={2}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-currency">Base currency</Label>
              <Select value={currency} onValueChange={(value) => setCurrency(value ?? '')}>
                <SelectTrigger id="group-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Every balance is shown in this currency. Expenses in other
                currencies are converted with the group's own rate table.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>
              Create group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PendingInvites({ onChanged }: { onChanged: () => void }) {
  const invites = useAsync(() => api.myInvites(), [])

  async function respond(id: string, accept: boolean) {
    try {
      if (accept) await api.acceptInvite(id)
      else await api.declineInvite(id)
      toast.success(accept ? 'Joined the group' : 'Invite declined')
      await invites.reload()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not respond to the invite')
    }
  }

  if (!invites.data?.length) return null

  return (
    <Card className="mb-6 border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base">
          {invites.data.length === 1 ? 'You have an invitation' : 'You have invitations'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {invites.data.map((invite) => (
          <div
            key={invite.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"
          >
            <div>
              <p className="font-medium">{invite.group_name}</p>
              <p className="text-xs text-muted-foreground">
                Invited by {invite.invited_by?.display_name ?? 'a member'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void respond(invite.id, true)}>
                <Check className="size-4" aria-hidden />
                Join
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void respond(invite.id, false)}
              >
                <X className="size-4" aria-hidden />
                Decline
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const groups = useAsync(() => api.listGroups(), [])
  const { user } = useAuth()

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your groups</h1>
          <p className="text-sm text-muted-foreground">
            Every group keeps its own balance and its own settle-up plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportSplitwiseDialog
            groups={groups.data ?? []}
            currentUserEmail={user?.email ?? ''}
            onImported={() => void groups.reload()}
          />
          <CreateGroupDialog onCreated={() => void groups.reload()} />
        </div>
      </div>

      <PendingInvites onChanged={() => void groups.reload()} />

      {groups.error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm text-destructive">
            {groups.error}
          </CardContent>
        </Card>
      ) : null}

      {groups.loading && !groups.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : null}

      {groups.data?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted">
              <Users className="size-5 text-muted-foreground" aria-hidden />
            </span>
            <div>
              <p className="font-medium">No groups yet</p>
              <p className="text-sm text-muted-foreground">
                Create one and invite people by email — or import a group
                straight out of Splitwise.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.data?.map((group) => (
          <Card key={group.id} className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="truncate">
                <Link to={`/groups/${group.id}`} className="hover:underline">
                  {group.name}
                </Link>
              </CardTitle>
              <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                {group.description || 'No description'}
              </CardDescription>
              <CardAction>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  {group.base_currency}
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Your balance</span>
                <NetBadge
                  amount={group.your_net}
                  currency={group.base_currency}
                  showLabel
                />
              </div>
              <div className="flex justify-between border-t pt-3 text-xs text-muted-foreground">
                <span>
                  {group.member_count} member{group.member_count === 1 ? '' : 's'}
                </span>
                <span>
                  {group.expense_count} expense{group.expense_count === 1 ? '' : 's'} ·{' '}
                  {formatMoney(group.total_spend, group.base_currency)}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
