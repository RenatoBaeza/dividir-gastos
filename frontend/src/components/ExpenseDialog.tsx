import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { PersonAvatar } from '@/components/PersonAvatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import {
  CATEGORIES,
  CURRENCIES,
  displayName,
  formatMoney,
  num,
  today,
} from '@/lib/format'
import { previewSplit } from '@/lib/split'
import type { Expense, ExpenseInput, Group, SplitType, User } from '@/types'

const SPLIT_TABS: { value: SplitType; label: string; hint: string }[] = [
  { value: 'equal', label: 'Equally', hint: 'Everyone selected pays the same.' },
  { value: 'exact', label: 'Exact', hint: 'Type the exact amount each person owes.' },
  { value: 'percent', label: '%', hint: 'Percentages have to add up to 100.' },
  { value: 'shares', label: 'Shares', hint: 'Weights, e.g. 2 shares for a couple.' },
  { value: 'items', label: 'Items', hint: 'Itemise the receipt line by line.' },
]

interface ItemDraft {
  name: string
  amount: string
  quantity: string
  sharedWith: string[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: Group | null
  expense?: Expense | null
  currentUserId: string
  onSaved: () => void
}

export function ExpenseDialog({
  open,
  onOpenChange,
  group,
  expense,
  currentUserId,
  onSaved,
}: Props) {
  const isEdit = Boolean(expense)
  const members: User[] = useMemo(
    () => group?.members.map((m) => m.user) ?? [],
    [group],
  )

  // Only currencies the group can actually convert. Personal expenses have no
  // base currency to convert to, so anything goes.
  const currencyOptions = useMemo(() => {
    if (!group) return [...CURRENCIES]
    return [group.base_currency, ...group.rates.map((r) => r.currency)]
  }, [group])

  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [category, setCategory] = useState('general')
  const [currency, setCurrency] = useState('USD')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [splitType, setSplitType] = useState<SplitType>('equal')

  const [multiplePayers, setMultiplePayers] = useState(false)
  const [singlePayer, setSinglePayer] = useState(currentUserId)
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>({})

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [items, setItems] = useState<ItemDraft[]>([])
  const [busy, setBusy] = useState(false)

  // Reset the form every time the dialog opens, from the expense being edited
  // or from sensible defaults for a new one.
  useEffect(() => {
    if (!open) return

    if (expense) {
      setDescription(expense.description)
      setNotes(expense.notes)
      setCategory(expense.category)
      setCurrency(expense.currency)
      setAmount(expense.amount)
      setDate(expense.expense_date)
      setSplitType(expense.split_type)
      setMultiplePayers(expense.payers.length > 1)
      setSinglePayer(expense.payers[0]?.user_id ?? currentUserId)
      setPayerAmounts(
        Object.fromEntries(expense.payers.map((p) => [p.user_id, p.amount])),
      )
      setSelected(Object.fromEntries(expense.splits.map((s) => [s.user_id, true])))
      setValues(
        Object.fromEntries(
          expense.splits.map((s) => [
            s.user_id,
            expense.split_type === 'percent'
              ? (s.percent ?? '')
              : expense.split_type === 'shares'
                ? (s.share_units ?? '')
                : expense.split_type === 'exact'
                  ? s.amount
                  : '',
          ]),
        ),
      )
      setItems(
        expense.items.map((i) => ({
          name: i.name,
          amount: i.amount,
          quantity: i.quantity,
          sharedWith: i.shared_with,
        })),
      )
      return
    }

    setDescription('')
    setNotes('')
    setCategory('general')
    setCurrency(group?.base_currency ?? 'USD')
    setAmount('')
    setDate(today())
    setSplitType('equal')
    setMultiplePayers(false)
    setSinglePayer(currentUserId)
    setPayerAmounts({})
    setSelected(Object.fromEntries(members.map((m) => [m.id, true])))
    setValues({})
    setItems([{ name: '', amount: '', quantity: '1', sharedWith: [] }])
  }, [open, expense, group, members, currentUserId])

  const total = num(amount)
  const participants = members
    .filter((m) => selected[m.id])
    .map((m) => ({ userId: m.id, value: values[m.id] ?? '' }))

  const preview = useMemo(
    () =>
      group
        ? previewSplit(
            splitType,
            total,
            participants,
            items.map((i) => ({
              amount: i.amount,
              quantity: i.quantity,
              sharedWith: i.sharedWith,
            })),
          )
        : { shares: {}, error: null },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, splitType, total, JSON.stringify(participants), JSON.stringify(items)],
  )

  const payersList = multiplePayers
    ? members
        .filter((m) => num(payerAmounts[m.id]) > 0)
        .map((m) => ({ user_id: m.id, amount: payerAmounts[m.id] }))
    : [{ user_id: singlePayer, amount: amount || '0' }]

  const paidSum = payersList.reduce((sum, p) => sum + num(p.amount), 0)
  const payerMismatch =
    group !== null && total > 0 && Math.round((paidSum - total) * 100) !== 0

  function toggleItemPerson(index: number, userId: string) {
    setItems((current) =>
      current.map((item, i) =>
        i === index
          ? {
              ...item,
              sharedWith: item.sharedWith.includes(userId)
                ? item.sharedWith.filter((id) => id !== userId)
                : [...item.sharedWith, userId],
            }
          : item,
      ),
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const payload: ExpenseInput = {
        group_id: group?.id ?? null,
        description: description.trim(),
        notes: notes.trim(),
        category,
        currency,
        amount: String(num(amount).toFixed(2)),
        expense_date: date,
        split_type: group ? splitType : 'equal',
        payers: group ? payersList : [],
        participants: group
          ? participants.map((p) => ({
              user_id: p.userId,
              value: ['exact', 'percent', 'shares'].includes(splitType)
                ? p.value || '0'
                : null,
            }))
          : [],
        items:
          group && splitType === 'items'
            ? items
                .filter((i) => i.name.trim() && num(i.amount) > 0)
                .map((i) => ({
                  name: i.name.trim(),
                  amount: String(num(i.amount).toFixed(2)),
                  quantity: i.quantity || '1',
                  shared_with: i.sharedWith,
                }))
            : [],
      }

      if (expense) await api.updateExpense(expense.id, payload)
      else await api.createExpense(payload)

      toast.success(isEdit ? 'Expense updated' : 'Expense added')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the expense')
    } finally {
      setBusy(false)
    }
  }

  const activeHint = SPLIT_TABS.find((t) => t.value === splitType)?.hint
  const canSubmit =
    description.trim().length > 0 &&
    total > 0 &&
    !busy &&
    (!group || (!preview.error && !payerMismatch))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <form onSubmit={submit} className="flex max-h-[92vh] flex-col">
          <DialogHeader className="border-b p-6">
            <DialogTitle>{isEdit ? 'Edit expense' : 'Add an expense'}</DialogTitle>
            <DialogDescription>
              {group
                ? `Shared in ${group.name}. Balances update the moment you save.`
                : 'A personal expense. Only you can see it and it never affects a group balance.'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="space-y-6 p-6">
              {/* ---------- what & how much ---------- */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="expense-description">Description</Label>
                  <Input
                    id="expense-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Dinner at Cantina"
                    required
                    autoFocus
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="expense-amount">Amount</Label>
                  <div className="flex gap-2">
                    <Input
                      id="expense-amount"
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
                  {group && currencyOptions.length === 1 ? (
                    <p className="text-xs text-muted-foreground">
                      Add a rate in group settings to spend in another currency.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="expense-date">Date</Label>
                  <Input
                    id="expense-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="expense-category">Category</Label>
                  <Select value={category} onValueChange={(value) => setCategory(value ?? '')}>
                    <SelectTrigger id="expense-category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="expense-notes">Notes</Label>
                  <Textarea
                    id="expense-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={1}
                    placeholder="Optional"
                  />
                </div>
              </div>

              {group ? (
                <>
                  <Separator />

                  {/* ---------- who paid ---------- */}
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Paid by</Label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={multiplePayers}
                          onCheckedChange={setMultiplePayers}
                        />
                        More than one person paid
                      </label>
                    </div>

                    {multiplePayers ? (
                      <div className="space-y-2 rounded-lg border p-3">
                        {members.map((member) => (
                          <div key={member.id} className="flex items-center gap-3">
                            <PersonAvatar user={member} className="size-7" />
                            <span className="flex-1 truncate text-sm">
                              {displayName(member)}
                            </span>
                            <Input
                              className="w-32"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={payerAmounts[member.id] ?? ''}
                              onChange={(e) =>
                                setPayerAmounts((current) => ({
                                  ...current,
                                  [member.id]: e.target.value,
                                }))
                              }
                            />
                          </div>
                        ))}
                        <p
                          className={
                            payerMismatch
                              ? 'text-xs text-destructive'
                              : 'text-xs text-muted-foreground'
                          }
                        >
                          Paid {formatMoney(paidSum, currency)} of{' '}
                          {formatMoney(total, currency)}
                        </p>
                      </div>
                    ) : (
                      <Select value={singlePayer} onValueChange={(value) => setSinglePayer(value ?? '')}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((member) => (
                            <SelectItem key={member.id} value={member.id}>
                              {member.id === currentUserId
                                ? 'You'
                                : displayName(member)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </section>

                  <Separator />

                  {/* ---------- how it splits ---------- */}
                  <section className="space-y-3">
                    <Label className="text-sm font-medium">Split</Label>
                    <Tabs
                      value={splitType}
                      onValueChange={(value) => setSplitType((value ?? 'equal') as SplitType)}
                    >
                      <TabsList className="w-full">
                        {SPLIT_TABS.map((tab) => (
                          <TabsTrigger key={tab.value} value={tab.value}>
                            {tab.label}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                    <p className="text-xs text-muted-foreground">{activeHint}</p>

                    {splitType === 'items' ? (
                      <div className="space-y-3">
                        {items.map((item, index) => (
                          <div key={index} className="space-y-2 rounded-lg border p-3">
                            <div className="flex gap-2">
                              <Input
                                className="flex-1"
                                placeholder="Item"
                                value={item.name}
                                onChange={(e) =>
                                  setItems((current) =>
                                    current.map((it, i) =>
                                      i === index ? { ...it, name: e.target.value } : it,
                                    ),
                                  )
                                }
                              />
                              <Input
                                className="w-20"
                                inputMode="decimal"
                                placeholder="Qty"
                                value={item.quantity}
                                onChange={(e) =>
                                  setItems((current) =>
                                    current.map((it, i) =>
                                      i === index
                                        ? { ...it, quantity: e.target.value }
                                        : it,
                                    ),
                                  )
                                }
                              />
                              <Input
                                className="w-28"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={item.amount}
                                onChange={(e) =>
                                  setItems((current) =>
                                    current.map((it, i) =>
                                      i === index
                                        ? { ...it, amount: e.target.value }
                                        : it,
                                    ),
                                  )
                                }
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  setItems((current) =>
                                    current.filter((_, i) => i !== index),
                                  )
                                }
                                aria-label="Remove item"
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {members.map((member) => {
                                const on = item.sharedWith.includes(member.id)
                                return (
                                  <button
                                    key={member.id}
                                    type="button"
                                    onClick={() => toggleItemPerson(index, member.id)}
                                    className={
                                      on
                                        ? 'rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground'
                                        : 'rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted'
                                    }
                                  >
                                    {member.id === currentUserId
                                      ? 'You'
                                      : displayName(member)}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setItems((current) => [
                              ...current,
                              { name: '', amount: '', quantity: '1', sharedWith: [] },
                            ])
                          }
                        >
                          <Plus className="size-4" aria-hidden />
                          Add item
                        </Button>
                      </div>
                    ) : (
                      <div className="divide-y rounded-lg border">
                        {members.map((member) => (
                          <div
                            key={member.id}
                            className="flex items-center gap-3 px-3 py-2"
                          >
                            <Checkbox
                              id={`split-${member.id}`}
                              checked={Boolean(selected[member.id])}
                              onCheckedChange={(checked) =>
                                setSelected((current) => ({
                                  ...current,
                                  [member.id]: checked === true,
                                }))
                              }
                            />
                            <PersonAvatar user={member} className="size-7" />
                            <Label
                              htmlFor={`split-${member.id}`}
                              className="flex-1 truncate font-normal"
                            >
                              {member.id === currentUserId ? 'You' : displayName(member)}
                            </Label>

                            {splitType !== 'equal' && selected[member.id] ? (
                              <Input
                                className="w-24"
                                inputMode="decimal"
                                placeholder={splitType === 'percent' ? '%' : '0'}
                                value={values[member.id] ?? ''}
                                onChange={(e) =>
                                  setValues((current) => ({
                                    ...current,
                                    [member.id]: e.target.value,
                                  }))
                                }
                              />
                            ) : null}

                            <span className="w-24 text-right text-sm tabular-nums text-muted-foreground">
                              {selected[member.id] && preview.shares[member.id] !== undefined
                                ? formatMoney(preview.shares[member.id], currency)
                                : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {splitType === 'items' && Object.keys(preview.shares).length > 0 ? (
                      <div className="divide-y rounded-lg border">
                        {members
                          .filter((m) => preview.shares[m.id] !== undefined)
                          .map((member) => (
                            <div
                              key={member.id}
                              className="flex items-center justify-between px-3 py-2 text-sm"
                            >
                              <span>
                                {member.id === currentUserId ? 'You' : displayName(member)}
                              </span>
                              <span className="tabular-nums">
                                {formatMoney(preview.shares[member.id], currency)}
                              </span>
                            </div>
                          ))}
                      </div>
                    ) : null}

                    {preview.error ? (
                      <p className="text-xs text-destructive">{preview.error}</p>
                    ) : null}
                  </section>
                </>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter className="border-t p-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isEdit ? 'Save changes' : 'Add expense'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
