import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Trash2, UserMinus } from 'lucide-react'
import { toast } from 'sonner'

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
import { api } from '@/lib/api'
import { CURRENCIES, displayName, formatDate } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import type { Group } from '@/types'

interface Props {
  group: Group
  currentUserId: string
  onChanged: () => void
}

export function SettingsTab({ group, currentUserId, onChanged }: Props) {
  const navigate = useNavigate()
  const invites = useAsync(() => api.listGroupInvites(group.id), [group.id])

  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description)
  const [baseCurrency, setBaseCurrency] = useState(group.base_currency)
  const [inviteEmail, setInviteEmail] = useState('')
  const [rateCurrency, setRateCurrency] = useState('EUR')
  const [rateValue, setRateValue] = useState('')
  const [busy, setBusy] = useState(false)

  const isOwner =
    group.members.find((m) => m.user.id === currentUserId)?.role === 'owner'

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
              Changing this re-converts every stored amount using the rate table,
              so make sure the rates you need are set first.
            </p>
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              void guard(
                () =>
                  api.updateGroup(group.id, {
                    name,
                    description,
                    base_currency: baseCurrency,
                  }),
                'Group updated',
              )
            }
          >
            Save changes
          </Button>
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
            {group.members.map((member) => (
              <li key={member.user.id} className="flex items-center gap-3 p-3">
                <PersonAvatar user={member.user} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {displayName(member.user)}
                    {member.user.id === currentUserId ? ' (you)' : ''}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.user.email} · joined {formatDate(member.joined_at)}
                  </p>
                </div>
                {member.role === 'owner' ? (
                  <Badge variant="secondary">Owner</Badge>
                ) : null}
                {(isOwner || member.user.id === currentUserId) &&
                group.members.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label="Remove member"
                    onClick={() =>
                      void guard(async () => {
                        await api.removeMember(group.id, member.user.id)
                        if (member.user.id === currentUserId) navigate('/')
                      }, 'Member removed')
                    }
                  >
                    <UserMinus className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void guard(async () => {
                await api.invite(group.id, inviteEmail.trim())
                setInviteEmail('')
                await invites.reload()
              }, 'Invitation sent')
            }}
          >
            <Input
              type="email"
              placeholder="friend@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy || !inviteEmail.trim()}>
              <Mail className="size-4" aria-hidden />
              Invite
            </Button>
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
                    aria-label="Revoke invite"
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
                    aria-label={`Delete ${rate.currency} rate`}
                    disabled={busy}
                    onClick={() =>
                      void guard(
                        () => api.deleteRate(group.id, rate.currency),
                        `${rate.currency} rate removed`,
                      )
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only {group.base_currency} is available so far.
            </p>
          )}

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void guard(async () => {
                await api.setRate(group.id, rateCurrency, rateValue)
                setRateValue('')
              }, 'Rate saved')
            }}
          >
            <Select value={rateCurrency} onValueChange={(value) => setRateCurrency(value ?? '')}>
              <SelectTrigger className="w-28">
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
            <Input
              inputMode="decimal"
              placeholder={`Rate to ${group.base_currency}`}
              value={rateValue}
              onChange={(e) => setRateValue(e.target.value)}
              required
            />
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
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete “${group.name}”? This cannot be undone.`))
                  return
                void guard(async () => {
                  await api.deleteGroup(group.id)
                  navigate('/')
                }, 'Group deleted')
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete this group
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
