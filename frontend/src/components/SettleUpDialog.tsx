import { useEffect, useState } from 'react'
import { ArrowLeftRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { AmountInput } from '@/components/AmountInput'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { displayName, formatMoney, num, today } from '@/lib/format'
import { submitOnMetaEnter } from '@/lib/useHotkey'
import type { Group, SettlementMethod } from '@/types'

export interface SettlePrefill {
  fromUserId: string
  toUserId: string
  amount: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: Group
  currentUserId: string
  prefill?: SettlePrefill | null
  onSaved: () => void
}

export function SettleUpDialog({
  open,
  onOpenChange,
  group,
  currentUserId,
  prefill,
  onSaved,
}: Props) {
  const members = group.members.map((m) => m.user)
  const others = members.filter((m) => m.id !== currentUserId)

  const [fromUserId, setFromUserId] = useState(currentUserId)
  const [toUserId, setToUserId] = useState(others[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(group.base_currency)
  const [method, setMethod] = useState<SettlementMethod>('outside')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [showProblems, setShowProblems] = useState(false)

  useEffect(() => {
    if (!open) return
    setFromUserId(prefill?.fromUserId ?? currentUserId)
    setToUserId(prefill?.toUserId ?? others[0]?.id ?? '')
    setAmount(prefill?.amount ?? '')
    setCurrency(group.base_currency)
    setMethod('outside')
    setNote('')
    setDate(today())
    setShowProblems(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill, currentUserId, group.base_currency])

  const currencyOptions = [group.base_currency, ...group.rates.map((r) => r.currency)]

  const label = (id: string) => {
    const person = members.find((m) => m.id === id)
    if (!person) return 'Someone'
    return person.id === currentUserId ? 'You' : displayName(person)
  }

  /** Picking the same person on both sides used to leave the second select
   *  showing nothing at all. Swapping keeps a valid pair either way. */
  function pickFrom(next: string) {
    if (next === toUserId) setToUserId(fromUserId)
    setFromUserId(next)
  }

  function pickTo(next: string) {
    if (next === fromUserId) setFromUserId(toUserId)
    setToUserId(next)
  }

  function swap() {
    setFromUserId(toUserId)
    setToUserId(fromUserId)
  }

  // Base UI needs the labels or a closed select shows the raw user id.
  const memberItems = members.map((m) => ({ value: m.id, label: label(m.id) }))
  const methodItems = [
    { value: 'outside', label: 'Paid outside the app' },
    { value: 'in_app', label: 'Marked settled here' },
  ]

  const blocker =
    num(amount) <= 0
      ? 'Enter an amount greater than zero.'
      : !toUserId || fromUserId === toUserId
        ? 'Pick two different people.'
        : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (blocker) {
      setShowProblems(true)
      return
    }

    setBusy(true)
    try {
      await api.recordSettlement(group.id, {
        from_user_id: fromUserId,
        to_user_id: toUserId,
        currency,
        amount: num(amount).toFixed(2),
        method,
        note: note.trim(),
        settled_on: date,
      })
      toast.success('Repayment recorded')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record the repayment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} onKeyDown={submitOnMetaEnter} noValidate>
          <DialogHeader>
            <DialogTitle>Record a repayment</DialogTitle>
            <DialogDescription>
              Log a payment that already happened — cash, a bank transfer, anything.
              This app never moves money itself.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div className="grid gap-2">
                <Label htmlFor="settle-from">Who paid</Label>
                <Select
                  items={memberItems}
                  value={fromUserId}
                  onValueChange={(value) => pickFrom(value ?? '')}
                >
                  <SelectTrigger id="settle-from" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {label(m.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mb-0.5"
                      onClick={swap}
                      aria-label="Swap who paid and who received"
                    />
                  }
                >
                  <ArrowLeftRight className="size-4" aria-hidden />
                </TooltipTrigger>
                <TooltipContent>Swap the direction</TooltipContent>
              </Tooltip>
              <div className="grid gap-2">
                <Label htmlFor="settle-to">Who received</Label>
                <Select
                  items={memberItems}
                  value={toUserId}
                  onValueChange={(value) => pickTo(value ?? '')}
                >
                  <SelectTrigger id="settle-to" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id} disabled={m.id === fromUserId}>
                        {label(m.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* The direction of a payment is the one thing worth restating in
                plain words before it hits everyone's balances. */}
            {!blocker ? (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {label(fromUserId)} paid {label(toUserId)}{' '}
                {formatMoney(amount, currency)}.
              </p>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="settle-amount">Amount</Label>
              <div className="flex gap-2">
                <AmountInput
                  id="settle-amount"
                  value={amount}
                  onValueChange={setAmount}
                  placeholder="0.00"
                />
                <Select value={currency} onValueChange={(value) => setCurrency(value ?? '')}>
                  <SelectTrigger className="w-28" aria-label="Currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencyOptions.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {currency !== group.base_currency ? (
                <p className="text-xs text-muted-foreground">
                  Converted to {group.base_currency} with the group's rate before it
                  touches the balances.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="settle-date">Date</Label>
                <Input
                  id="settle-date"
                  type="date"
                  max={today()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settle-method">How</Label>
                <Select
                  items={methodItems}
                  value={method}
                  onValueChange={(value) => setMethod((value ?? 'outside') as SettlementMethod)}
                >
                  <SelectTrigger id="settle-method" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outside">Paid outside the app</SelectItem>
                    <SelectItem value="in_app">Marked settled here</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settle-note">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="settle-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Bank transfer, ref 4471"
              />
            </div>
          </div>

          <DialogFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <p
              aria-live="polite"
              className={
                showProblems && blocker ? 'flex-1 text-xs text-destructive' : 'flex-1 text-xs'
              }
            >
              {showProblems && blocker ? blocker : ''}
            </p>
            <div className="flex justify-end gap-2">
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
                Record repayment
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
