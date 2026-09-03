import { useMemo, useState } from 'react'
import { ArrowRight, HandCoins, Info, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { useConfirm } from '@/components/ConfirmDialog'
import { MoneyDelta } from '@/components/MoneyDelta'
import { PersonAvatar } from '@/components/PersonAvatar'
import { SettleUpDialog, type SettlePrefill } from '@/components/SettleUpDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { displayName, formatDate, formatMoney, pluralize } from '@/lib/format'
import { usePersistentState } from '@/lib/usePersistentState'
import type { Balances, Group, Settlement, Transfer } from '@/types'

interface Props {
  group: Group
  balances: Balances
  settlements: Settlement[]
  currentUserId: string
  onChanged: () => void
}

export function BalancesTab({
  group,
  balances,
  settlements,
  currentUserId,
  onChanged,
}: Props) {
  // Whichever view someone prefers, they prefer it every time.
  const [simplify, setSimplify] = usePersistentState('balances.simplify', true)
  const [settleOpen, setSettleOpen] = useState(false)
  const [prefill, setPrefill] = useState<SettlePrefill | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const confirm = useConfirm()

  const people = useMemo(() => {
    const map = new Map(balances.balances.map((row) => [row.user.id, row.user]))
    for (const member of group.members) map.set(member.user.id, member.user)
    return map
  }, [balances.balances, group.members])

  const nameOf = (id: string) => {
    const person = people.get(id)
    if (!person) return 'a former member'
    return person.id === currentUserId ? 'You' : displayName(person)
  }

  const plan: Transfer[] = simplify ? balances.simplified : balances.pairwise
  const mine = plan.filter(
    (t) => t.from_user_id === currentUserId || t.to_user_id === currentUserId,
  )

  function settle(transfer?: Transfer) {
    setPrefill(
      transfer
        ? {
            fromUserId: transfer.from_user_id,
            toUserId: transfer.to_user_id,
            amount: transfer.amount,
          }
        : null,
    )
    setSettleOpen(true)
  }

  async function removeSettlement(settlement: Settlement) {
    const ok = await confirm({
      title: 'Delete this repayment?',
      description: (
        <>
          {nameOf(settlement.from_user_id)} paid {nameOf(settlement.to_user_id)}{' '}
          {formatMoney(settlement.amount, settlement.currency)} on{' '}
          {formatDate(settlement.settled_on)}. Deleting it puts that debt back on
          the balances for everyone in the group.
        </>
      ),
      confirmLabel: 'Delete repayment',
      destructive: true,
    })
    if (!ok) return

    setBusyId(settlement.id)
    try {
      await api.deleteSettlement(settlement.id)
      toast.success('Repayment deleted')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the repayment')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      {balances.missing_rates.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>These totals are incomplete</AlertTitle>
          <AlertDescription>
            {balances.missing_rates.join(', ')} have no exchange rate to{' '}
            {group.base_currency}, so expenses in{' '}
            {balances.missing_rates.length === 1 ? 'that currency' : 'those currencies'}{' '}
            are missing from every number on this page. Add the{' '}
            {pluralize(balances.missing_rates.length, 'rate')} under Settings.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------------- net positions ---------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Balances</CardTitle>
            <CardDescription>
              Net position per member, in {group.base_currency}.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {balances.balances.map((row) => {
                const isMe = row.user.id === currentUserId
                return (
                  <li
                    key={row.user.id}
                    className={
                      isMe
                        ? 'flex items-center gap-3 bg-muted/40 px-6 py-3'
                        : 'flex items-center gap-3 px-6 py-3'
                    }
                  >
                    <PersonAvatar user={row.user} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {isMe ? 'You' : displayName(row.user)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        paid {formatMoney(row.paid, group.base_currency)} · share{' '}
                        {formatMoney(row.owed, group.base_currency)}
                      </p>
                    </div>
                    <div className="text-right">
                      <MoneyDelta
                        amount={row.net}
                        currency={group.base_currency}
                        showLabel
                        labels={
                          isMe
                            ? ['you are owed', 'you owe', 'settled up']
                            : ['is owed', 'owes', 'settled up']
                        }
                        className="flex flex-col items-end"
                        labelClassName="mr-0 block text-muted-foreground"
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        {/* ---------------- settle-up plan ---------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Settle up
              {simplify && balances.transfers_saved > 0 ? (
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="size-3" aria-hidden />
                  {pluralize(balances.transfers_saved, 'fewer payment', 'fewer payments')}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              {formatMoney(balances.total_outstanding, group.base_currency)} outstanding
              across {pluralize(plan.length, 'payment')}.
            </CardDescription>
            <div className="flex items-center gap-2 pt-2">
              <Switch id="simplify" checked={simplify} onCheckedChange={setSimplify} />
              <label htmlFor="simplify" className="text-xs text-muted-foreground">
                Simplify debts
              </label>
              {/* A switch that silently rearranges who pays whom needs to say
                  what it does before someone transfers money on its say-so. */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="What does simplifying debts do?"
                    />
                  }
                >
                  <Info className="size-3.5" aria-hidden />
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  On: everyone ends up square in the fewest possible transfers,
                  which can mean paying someone you never shared an expense with.
                  Off: each pair settles exactly what passed between the two of
                  them.
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {plan.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                Everyone is square. Nothing to pay.
              </p>
            ) : (
              <>
                {mine.length > 0 ? (
                  <p className="px-6 pb-2 text-xs text-muted-foreground">
                    {pluralize(mine.length, 'payment')} involving you.
                  </p>
                ) : null}
                <ul className="divide-y">
                  {plan.map((transfer, index) => {
                    const involvesMe =
                      transfer.from_user_id === currentUserId ||
                      transfer.to_user_id === currentUserId
                    return (
                      <li
                        key={`${transfer.from_user_id}-${transfer.to_user_id}-${index}`}
                        className={
                          involvesMe
                            ? 'flex flex-wrap items-center gap-3 bg-muted/40 px-6 py-3'
                            : 'flex flex-wrap items-center gap-3 px-6 py-3'
                        }
                      >
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{nameOf(transfer.from_user_id)}</span>
                          <ArrowRight
                            className="mx-2 inline size-3 text-muted-foreground"
                            aria-label="pays"
                          />
                          <span className="font-medium">{nameOf(transfer.to_user_id)}</span>
                        </div>
                        <span className="tabular-nums">
                          {formatMoney(transfer.amount, group.base_currency)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => settle(transfer)}
                          aria-label={`Record ${nameOf(transfer.from_user_id)} paying ${nameOf(
                            transfer.to_user_id,
                          )} ${formatMoney(transfer.amount, group.base_currency)}`}
                        >
                          Record
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------- repayments ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Repayments</CardTitle>
          <CardDescription>
            Payments already made, in or outside the app.
          </CardDescription>
          <Button className="mt-2 w-fit" size="sm" variant="outline" onClick={() => settle()}>
            <HandCoins className="size-4" aria-hidden />
            Record a repayment
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {settlements.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No repayments recorded yet. Log one whenever money actually changes
              hands — this app never moves it for you.
            </p>
          ) : (
            <ul className="divide-y">
              {settlements.map((settlement) => (
                <li key={settlement.id} className="flex items-center gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{nameOf(settlement.from_user_id)}</span>{' '}
                      paid{' '}
                      <span className="font-medium">{nameOf(settlement.to_user_id)}</span>{' '}
                      {formatMoney(settlement.amount, settlement.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(settlement.settled_on)} ·{' '}
                      {settlement.method === 'outside'
                        ? 'outside the app'
                        : 'marked settled here'}
                      {settlement.note ? ` · ${settlement.note}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busyId === settlement.id}
                    aria-label={`Delete the repayment from ${nameOf(
                      settlement.from_user_id,
                    )} to ${nameOf(settlement.to_user_id)}`}
                    onClick={() => void removeSettlement(settlement)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <SettleUpDialog
        open={settleOpen}
        onOpenChange={setSettleOpen}
        group={group}
        currentUserId={currentUserId}
        prefill={prefill}
        onSaved={onChanged}
      />
    </div>
  )
}
