import { useEffect, useState } from 'react'
import { toast } from 'sonner'

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
import { api } from '@/lib/api'
import { displayName, num, today } from '@/lib/format'
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

  useEffect(() => {
    if (!open) return
    setFromUserId(prefill?.fromUserId ?? currentUserId)
    setToUserId(prefill?.toUserId ?? others[0]?.id ?? '')
    setAmount(prefill?.amount ?? '')
    setCurrency(group.base_currency)
    setMethod('outside')
    setNote('')
    setDate(today())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill, currentUserId, group.base_currency])

  const currencyOptions = [group.base_currency, ...group.rates.map((r) => r.currency)]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
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

  const label = (id: string) => {
    const person = members.find((m) => m.id === id)
    if (!person) return 'Someone'
    return person.id === currentUserId ? 'You' : displayName(person)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
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
                <Label>Who paid</Label>
                <Select value={fromUserId} onValueChange={(value) => setFromUserId(value ?? '')}>
                  <SelectTrigger className="w-full">
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
              <span className="pb-2 text-muted-foreground">→</span>
              <div className="grid gap-2">
                <Label>Who received</Label>
                <Select value={toUserId} onValueChange={(value) => setToUserId(value ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members
                      .filter((m) => m.id !== fromUserId)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {label(m.id)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settle-amount">Amount</Label>
              <div className="flex gap-2">
                <Input
                  id="settle-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
                <Select value={currency} onValueChange={(value) => setCurrency(value ?? '')}>
                  <SelectTrigger className="w-28">
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="settle-date">Date</Label>
                <Input
                  id="settle-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>How</Label>
                <Select
                  value={method}
                  onValueChange={(value) => setMethod((value ?? 'outside') as SettlementMethod)}
                >
                  <SelectTrigger className="w-full">
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
              <Label htmlFor="settle-note">Note</Label>
              <Input
                id="settle-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
              />
            </div>
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
            <Button
              type="submit"
              disabled={busy || num(amount) <= 0 || !toUserId || fromUserId === toUserId}
            >
              Record repayment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
