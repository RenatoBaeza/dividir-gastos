import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, Plus, Search, Users, X } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/auth/AuthProvider'
import { ImportSplitwiseDialog } from '@/components/ImportSplitwiseDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { MoneyDelta } from '@/components/MoneyDelta'
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
import { Kbd } from '@/components/Kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { CURRENCIES, formatMoney, num, pluralize } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useHotkey } from '@/lib/useHotkey'
import { useRevalidateOnFocus } from '@/lib/useRevalidate'
import type { GroupSummary } from '@/types'

/** Below this many groups a search box is just another thing to look at. */
const SEARCH_FROM = 6

function CreateGroupDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)

  function reset() {
    setName('')
    setDescription('')
    setCurrency('USD')
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    // The button stays live and says what is wrong, rather than sitting greyed
    // out while the person guesses which field it is waiting on.
    if (!name.trim()) {
      setError('Give the group a name first.')
      nameField.current?.focus()
      return
    }

    setBusy(true)
    setError(null)
    try {
      await api.createGroup({ name: name.trim(), description, base_currency: currency })
      toast.success('Created “' + name.trim() + '”')
      onOpenChange(false)
      reset()
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <form onSubmit={submit} noValidate>
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
                ref={nameField}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (error) setError(null)
                }}
                placeholder="Lisbon 2026"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'group-create-error' : undefined}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-description">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="group-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Four of us, one week, too many pastries"
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
                currencies are converted with the group's own rate table. You can
                change it later.
              </p>
            </div>

            {error ? (
              <p
                id="group-create-error"
                role="alert"
                className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
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
  const [busyId, setBusyId] = useState<string | null>(null)

  async function respond(id: string, accept: boolean) {
    setBusyId(id)
    try {
      if (accept) await api.acceptInvite(id)
      else await api.declineInvite(id)
      toast.success(accept ? 'Joined the group' : 'Invite declined')
      await invites.reload()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not respond to the invite')
    } finally {
      setBusyId(null)
    }
  }

  if (!invites.data?.length) return null

  return (
    <Card className="mb-6 border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base">
          {invites.data.length === 1
            ? 'You have an invitation'
            : `You have ${invites.data.length} invitations`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {invites.data.map((invite) => (
          <div
            key={invite.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{invite.group_name}</p>
              <p className="text-xs text-muted-foreground">
                Invited by {invite.invited_by?.display_name ?? 'a member'}
              </p>
            </div>
            <div className="flex gap-2">
              {/* Disabled across the whole row while one is in flight: two
                  clicks on "Join" used to fire two joins. */}
              <Button
                size="sm"
                disabled={busyId !== null}
                onClick={() => void respond(invite.id, true)}
              >
                {busyId === invite.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                Join
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busyId !== null}
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

/** What you are up or down across every group, per currency — the number
 *  people open the app for, and it was on no screen. */
function OverallPosition({ groups }: { groups: GroupSummary[] }) {
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>()
    for (const group of groups) {
      const net = num(group.your_net)
      if (Math.abs(net) < 0.005) continue
      byCurrency.set(group.base_currency, (byCurrency.get(group.base_currency) ?? 0) + net)
    }
    return [...byCurrency.entries()].filter(([, net]) => Math.abs(net) >= 0.005)
  }, [groups])

  if (groups.length < 2 || totals.length === 0) return null

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-background px-4 py-3">
      <span className="text-sm font-medium">Across all groups</span>
      {totals.map(([currency, net]) => (
        <span key={currency} className="text-sm">
          <MoneyDelta amount={net} currency={currency} showLabel />
        </span>
      ))}
    </div>
  )
}

function GroupCard({ group }: { group: GroupSummary }) {
  return (
    <Card className="relative transition-shadow focus-within:ring-2 focus-within:ring-ring hover:shadow-md">
      <CardHeader>
        <CardTitle className="truncate">
          {/* The whole card is the target. A card whose only hit area is a few
              words of title text is a card that gets missed on a phone. */}
          <Link
            to={`/groups/${group.id}`}
            className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {group.name}
          </Link>
        </CardTitle>
        <CardDescription className="line-clamp-2 min-h-[2.5rem]">
          {group.description || <span className="italic opacity-70">No description</span>}
        </CardDescription>
        <CardAction>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
            {group.base_currency}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">Your balance</span>
          <NetBadge amount={group.your_net} currency={group.base_currency} showLabel />
        </div>
        <div className="flex justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>{pluralize(group.member_count, 'member')}</span>
          <span className="truncate">
            {pluralize(group.expense_count, 'expense')} ·{' '}
            {formatMoney(group.total_spend, group.base_currency)}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const groups = useAsync(() => api.listGroups(), [])
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  useDocumentTitle('Your groups')
  useRevalidateOnFocus(() => void groups.reload())
  useHotkey('n', () => setCreateOpen(true))

  const all = useMemo(() => groups.data ?? [], [groups.data])
  const showSearch = all.length >= SEARCH_FROM
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (group) =>
        group.name.toLowerCase().includes(needle) ||
        group.description.toLowerCase().includes(needle),
    )
  }, [all, query])

  const importDialog = (
    <ImportSplitwiseDialog
      groups={all}
      currentUserEmail={user?.email ?? ''}
      onImported={() => void groups.reload()}
    />
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your groups</h1>
          <p className="text-sm text-muted-foreground">
            Every group keeps its own balance and its own settle-up plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {importDialog}
          <Tooltip>
            <TooltipTrigger render={<Button onClick={() => setCreateOpen(true)} />}>
              <Plus className="size-4" aria-hidden />
              New group
            </TooltipTrigger>
            <TooltipContent>
              Press <Kbd>N</Kbd> anywhere
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <CreateGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void groups.reload()}
      />

      <PendingInvites onChanged={() => void groups.reload()} />

      {groups.error ? (
        <ErrorState
          title="Could not load your groups"
          message={groups.error}
          onRetry={() => void groups.reload()}
          retrying={groups.loading || groups.refreshing}
        />
      ) : null}

      {groups.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
          <span className="sr-only" role="status">
            Loading your groups…
          </span>
        </div>
      ) : null}

      {groups.data ? (
        <>
          <OverallPosition groups={all} />

          {showSearch ? (
            <div className="relative mb-4 max-w-xs">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                className="pl-9"
                aria-label="Search your groups"
                placeholder="Search groups…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}

          {all.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No groups yet"
              description="Create one and invite people by email — or import a group straight out of Splitwise."
              action={
                <>
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="size-4" aria-hidden />
                    Create your first group
                  </Button>
                  {importDialog}
                </>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              compact
              icon={Search}
              title={`Nothing matches “${query.trim()}”`}
              action={
                <Button variant="outline" onClick={() => setQuery('')}>
                  Clear the search
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((group) => (
                <GroupCard key={group.id} group={group} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
