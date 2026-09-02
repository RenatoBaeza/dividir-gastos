import { useMemo, useState } from 'react'
import { ArrowRight, HandCoins, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

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
import { api } from '@/lib/api'
import { displayName, formatDate, formatMoney, num } from '@/lib/format'
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
  const [simplify, setSimplify] = useState(true)
  const [settleOpen, setSettleOpen] = useState(false)
  const [prefill, setPrefill] = useState<SettlePrefill | null>(null)

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
    if (!window.confirm('Delete this repayment?')) return
    try {
      await api.deleteSettlement(settlement.id)
      toast.success('Repayment deleted')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the repayment')
    }
  }

  return (
    <div className="space-y-6">
      {balances.missing_rates.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Missing exchange rates</AlertTitle>
          <AlertDescription>
            {balances.missing_rates.join(', ')} have no rate to{' '}
            {group.base_currency} yet, so these totals are incomplete. Add them
            under Settings.
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
                const net = num(row.net)
                return (
                  <li
                    key={row.user.id}
                    className="flex items-center gap-3 px-6 py-3"
                  >
                    <PersonAvatar user={row.user} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {row.user.id === currentUserId ? 'You' : displayName(row.user)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        paid {formatMoney(row.paid, group.base_currency)} · share{' '}
                        {formatMoney(row.owed, group.base_currency)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        {net > 0 ? 'is owed' : net < 0 ? 'owes' : 'settled up'}
                      </p>
                      <p
                        className={
                          net > 0
                            ? 'font-medium tabular-nums text-emerald-600 dark:text-emerald-400'
                            : net < 0
                              ? 'font-medium tabular-nums text-rose-600 dark:text-rose-400'
                              : 'font-medium tabular-nums text-muted-foreground'
                        }
                      >
                        {net === 0
                          ? '—'
                          : formatMoney(Math.abs(net), group.base_currency)}
                      </p>
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
            <CardTitle className="flex items-center gap-2 text-base">
              Settle up
              {simplify && balances.transfers_saved > 0 ? (
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="size-3" aria-hidden />
                  {balances.transfers_saved} fewer payment
                  {balances.transfers_saved === 1 ? '' : 's'}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              {formatMoney(balances.total_outstanding, group.base_currency)} outstanding
              across {plan.length} payment{plan.length === 1 ? '' : 's'}.
            </CardDescription>
            <div className="flex items-center gap-2 pt-2">
              <Switch
                id="simplify"
                checked={simplify}
                onCheckedChange={setSimplify}
              />
              <label htmlFor="simplify" className="text-xs text-muted-foreground">
                Simplify debts
              </label>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {plan.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                Everyone is square. Nothing to pay.
              </p>
            ) : (
              <ul className="divide-y">
                {plan.map((transfer, index) => (
                  <li
                    key={`${transfer.from_user_id}-${transfer.to_user_id}-${index}`}
                    className="flex items-center gap-3 px-6 py-3"
                  >
                    <div className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">
                        {nameOf(transfer.from_user_id)}
                      </span>
                      <ArrowRight
                        className="mx-2 inline size-3 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="font-medium">{nameOf(transfer.to_user_id)}</span>
                    </div>
                    <span className="tabular-nums">
                      {formatMoney(transfer.amount, group.base_currency)}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => settle(transfer)}>
                      Record
                    </Button>
                  </li>
                ))}
              </ul>
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
          <Button
            className="mt-2 w-fit"
            size="sm"
            variant="outline"
            onClick={() => settle()}
          >
            <HandCoins className="size-4" aria-hidden />
            Record a repayment
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {settlements.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No repayments recorded yet.
            </p>
          ) : (
            <ul className="divide-y">
              {settlements.map((settlement) => (
                <li key={settlement.id} className="flex items-center gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">
                        {nameOf(settlement.from_user_id)}
                      </span>{' '}
                      paid{' '}
                      <span className="font-medium">
                        {nameOf(settlement.to_user_id)}
                      </span>{' '}
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
                    aria-label="Delete repayment"
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
