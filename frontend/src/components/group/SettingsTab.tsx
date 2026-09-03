import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Loader2, Mail, Trash2, UserMinus } from 'lucide-react'
import { toast } from 'sonner'

import { AmountInput } from '@/components/AmountInput'
import { useConfirm } from '@/components/ConfirmDialog'
import { PersonAvatar } from '@/components/PersonAvatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { CURRENCIES, displayName, formatDate, looksLikeEmail, num } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import type { Group } from '@/types'

interface Props {
  group: Group
  currentUserId: string
  onChanged: () => void
}

export function SettingsTab({ group, currentUserId, onChanged }: Props) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const invites = useAsync(() => api.listGroupInvites(group.id), [group.id])

  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description)
  const [baseCurrency, setBaseCurrency] = useState(group.base_currency)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [rateCurrency, setRateCurrency] = useState<string>(
    CURRENCIES.find((c) => c !== group.base_currency) ?? 'EUR',
  )
  const [rateValue, setRateValue] = useState('')
  const [busy, setBusy] = useState(false)

  const isOwner =
    group.members.find((m) => m.user.id === currentUserId)?.role === 'owner'

  // Nothing to save is not the same as a broken button: the button says so.
  const dirty =
    name.trim() !== group.name ||
    description !== group.description ||
    baseCurrency !== group.base_currency
  const currencyChanged = baseCurrency !== group.base_currency

  async function guard(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function saveDetails() {
    if (!name.trim()) {
      toast.error('A group needs a name.')
      return
    }

    // Re-denominating every stored amount is not a "save changes" sort of
    // change, and there is no undo for it.
    if (currencyChanged) {
      const ok = await confirm({
        title: `Switch the base currency to ${baseCurrency}?`,
        description: (
          <>
            Every balance and every converted amount in this group will be
            recalculated from {group.base_currency} using the rate table. If a
            rate is missing, those expenses drop out of the totals until you add
            it.
          </>
        ),
        confirmLabel: `Switch to ${baseCurrency}`,
      })
      if (!ok) return
    }

    await guard(
      () =>
        api.updateGroup(group.id, {
          name: name.trim(),
          description,
          base_currency: baseCurrency,
        }),
      'Group updated',
    )
  }

  function submitInvite(event: React.FormEvent) {
    event.preventDefault()
    const email = inviteEmail.trim()

    if (!looksLikeEmail(email)) {
      setInviteError('That does not look like an email address.')
      return
    }
    if (group.members.some((m) => m.user.email.toLowerCase() === email.toLowerCase())) {
      setInviteError('They are already in this group.')
      return
    }

    setInviteError(null)
    void guard(async () => {
      await api.invite(group.id, email)
      setInviteEmail('')
      await invites.reload()
    }, `Invitation sent to ${email}`)
  }

  async function removeMember(userId: string, label: string, isSelf: boolean) {
    const ok = await confirm({
      title: isSelf ? `Leave “${group.name}”?` : `Remove ${label} from the group?`,
      description: isSelf
        ? 'You will stop seeing this group and its history. Anything you already owe or are owed stays on everyone else’s balances.'
        : `${label} will stop seeing this group. Their share of past expenses stays exactly where it is — this does not settle anything up.`,
      confirmLabel: isSelf ? 'Leave the group' : `Remove ${label}`,
      destructive: true,
    })
    if (!ok) return

    await guard(async () => {
      await api.removeMember(group.id, userId)
      if (isSelf) navigate('/')
    }, isSelf ? 'You left the group' : `${label} removed`)
  }

  function submitRate(event: React.FormEvent) {
    event.preventDefault()
    if (num(rateValue) <= 0) {
      toast.error('A rate has to be greater than zero.')
      return
    }
    void guard(async () => {
      await api.setRate(group.id, rateCurrency, rateValue)
      setRateValue('')
    }, `1 ${rateCurrency} = ${rateValue} ${group.base_currency}`)
  }

  async function deleteGroup() {
    const ok = await confirm({
      title: `Delete “${group.name}”?`,
      description:
        'Every expense, balance and repayment in this group stops being visible to everyone in it. This cannot be undone.',
      confirmLabel: 'Delete this group',
      destructive: true,
      // The only action in the app that destroys other people's data too.
      confirmText: group.name,
    })
    if (!ok) return

    await guard(async () => {
      await api.deleteGroup(group.id)
      navigate('/')
    }, 'Group deleted')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---------------- details ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Group details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={name.trim() ? undefined : true}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-description">Description</Label>
            <Textarea
              id="settings-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-currency">Base currency</Label>
            <Select
              value={baseCurrency}
              onValueChange={(value) => setBaseCurrency(value ?? '')}
              disabled={!isOwner}
            >
              <SelectTrigger id="settings-currency" className="w-full">
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
              {isOwner
                ? 'Changing this re-converts every stored amount using the rate table, so make sure the rates you need are set first.'
                : 'Only the group owner can change the base currency.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button disabled={busy || !dirty} onClick={() => void saveDetails()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save changes
            </Button>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {dirty ? 'You have unsaved changes.' : 'Everything is saved.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- members ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            Invite anyone by email. They join as soon as they sign in and accept.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y rounded-lg border">
            {group.members.map((member) => {
              const isSelf = member.user.id === currentUserId
              const label = displayName(member.user)
              const canRemove =
                (isOwner || isSelf) && group.members.length > 1

              return (
                <li key={member.user.id} className="flex items-center gap-3 p-3">
                  <PersonAvatar user={member.user} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {label}
                      {isSelf ? ' (you)' : ''}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.user.email} · joined {formatDate(member.joined_at)}
                    </p>
                  </div>
                  {member.role === 'owner' ? (
                    <Badge variant="secondary">Owner</Badge>
                  ) : null}
                  {canRemove ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={isSelf ? 'Leave this group' : `Remove ${label}`}
                            onClick={() =>
                              void removeMember(member.user.id, label, isSelf)
                            }
                          />
                        }
                      >
                        {isSelf ? (
                          <LogOut className="size-4" aria-hidden />
                        ) : (
                          <UserMinus className="size-4" aria-hidden />
                        )}
                      </TooltipTrigger>
                      <TooltipContent>
                        {isSelf ? 'Leave this group' : `Remove ${label}`}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <form className="grid gap-2" onSubmit={submitInvite} noValidate>
            <Label htmlFor="invite-email" className="sr-only">
              Invite someone by email
            </Label>
            <div className="flex gap-2">
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                placeholder="friend@example.com"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value)
                  if (inviteError) setInviteError(null)
                }}
                aria-invalid={inviteError ? true : undefined}
                aria-describedby={inviteError ? 'invite-error' : undefined}
              />
              <Button type="submit" disabled={busy}>
                <Mail className="size-4" aria-hidden />
                Invite
              </Button>
            </div>
            {inviteError ? (
              <p id="invite-error" role="alert" className="text-xs text-destructive">
                {inviteError}
              </p>
            ) : null}
          </form>

          {invites.data?.length ? (
            <ul className="divide-y rounded-lg border border-dashed">
              {invites.data.map((invite) => (
                <li key={invite.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Invited {formatDate(invite.created_at)} · waiting to join
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke the invitation to ${invite.email}`}
                    disabled={busy}
                    onClick={() =>
                      void guard(async () => {
                        await api.revokeInvite(group.id, invite.id)
                        await invites.reload()
                      }, 'Invitation revoked')
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------- rates ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exchange rates</CardTitle>
          <CardDescription>
            Set by hand — no rates are ever fetched from the internet. One unit of
            the currency equals this many {group.base_currency}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {group.rates.length ? (
            <ul className="divide-y rounded-lg border">
              {group.rates.map((rate) => (
                <li key={rate.currency} className="flex items-center gap-3 p-3">
                  <span className="w-14 text-sm font-medium">{rate.currency}</span>
                  <span className="flex-1 text-sm tabular-nums text-muted-foreground">
                    1 {rate.currency} = {rate.rate_to_base} {group.base_currency}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete the ${rate.currency} rate`}
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        const ok = await confirm({
                          title: `Remove the ${rate.currency} rate?`,
                          description: `Any expense recorded in ${rate.currency} will drop out of the balances until a new rate is set.`,
                          confirmLabel: 'Remove the rate',
                          destructive: true,
                        })
                        if (!ok) return
                        await guard(
                          () => api.deleteRate(group.id, rate.currency),
                          `${rate.currency} rate removed`,
                        )
                      })()
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only {group.base_currency} is available so far. Add a rate here to
              record expenses in another currency.
            </p>
          )}

          <form className="flex items-center gap-2" onSubmit={submitRate} noValidate>
            <span className="text-sm text-muted-foreground">1</span>
            <Select value={rateCurrency} onValueChange={(value) => setRateCurrency(value ?? '')}>
              <SelectTrigger className="w-28" aria-label="Currency to add a rate for">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.filter((c) => c !== group.base_currency).map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">=</span>
            <AmountInput
              value={rateValue}
              onValueChange={setRateValue}
              aria-label={`Value of 1 ${rateCurrency} in ${group.base_currency}`}
              placeholder="0.00"
            />
            <span className="shrink-0 text-sm text-muted-foreground">
              {group.base_currency}
            </span>
            <Button type="submit" disabled={busy || !rateValue}>
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ---------------- danger zone ---------------- */}
      {isOwner ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Delete group</CardTitle>
            <CardDescription>
              The group and its history stop being visible to everyone in it.
              There is no way back.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" disabled={busy} onClick={() => void deleteGroup()}>
              <Trash2 className="size-4" aria-hidden />
              Delete this group
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
