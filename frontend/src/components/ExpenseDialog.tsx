import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { AmountInput } from '@/components/AmountInput'
import { useConfirm } from '@/components/ConfirmDialog'
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
import { submitOnMetaEnter } from '@/lib/useHotkey'
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
  const confirm = useConfirm()
  const descriptionField = useRef<HTMLInputElement>(null)
  const amountField = useRef<HTMLInputElement>(null)

  const members: User[] = useMemo(() => group?.members.map((m) => m.user) ?? [], [group])

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
  const [showProblems, setShowProblems] = useState(false)
  const [resetAt, setResetAt] = useState(0)

  // A snapshot of the form as it opened, so we can tell a half-filled form from
  // an untouched one when somebody clicks outside it.
  const pristine = useRef('')
  const fingerprint = JSON.stringify({
    description,
    notes,
    category,
    currency,
    amount,
    date,
    splitType,
    multiplePayers,
    singlePayer,
    payerAmounts,
    selected,
    values,
    items,
  })

  // Reset the form every time the dialog opens, from the expense being edited
  // or from sensible defaults for a new one.
  useEffect(() => {
    if (!open) return
    setShowProblems(false)

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
      setPayerAmounts(Object.fromEntries(expense.payers.map((p) => [p.user_id, p.amount])))
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
      setResetAt((n) => n + 1)
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
    setResetAt((n) => n + 1)
  }, [open, expense, group, members, currentUserId])

  // Runs on the render *after* the reset above, so it records the form as the
  // person first sees it rather than whatever was left in it last time.
  useEffect(() => {
    pristine.current = fingerprint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetAt])

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
  const payerMismatch = group !== null && total > 0 && Math.round((paidSum - total) * 100) !== 0

  const rate = group?.rates.find((r) => r.currency === currency)?.rate_to_base
  const converted =
    group && currency !== group.base_currency && rate ? total * num(rate) : null
  const futureDate = date > today()

  /**
   * The single reason this cannot be saved yet, in the order a person fills the
   * form in. A submit button that is simply dead gives them nothing to act on,
   * so the button stays live and this says what to fix.
   */
  const blocker: { message: string; focus?: () => void } | null = !description.trim()
    ? { message: 'Give the expense a description.', focus: () => descriptionField.current?.focus() }
    : total <= 0
      ? { message: 'Enter an amount greater than zero.', focus: () => amountField.current?.focus() }
      : group && participants.length === 0
        ? { message: 'Pick at least one person to split this with.' }
        : group && payerMismatch
          ? {
              message: `Who paid adds up to ${formatMoney(paidSum, currency)}, but the expense is ${formatMoney(total, currency)}.`,
            }
          : group && preview.error
            ? { message: preview.error }
            : null

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

  /** Closing a dialog by clicking beside it must not silently bin ten minutes
   *  of typing. */
  async function requestClose(next: boolean) {
    if (next) {
      onOpenChange(true)
      return
    }
    if (busy) return

    if (fingerprint !== pristine.current) {
      const ok = await confirm({
        title: 'Discard this expense?',
        description: 'What you have typed here will not be saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        destructive: true,
      })
      if (!ok) return
    }
    onOpenChange(false)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    if (blocker) {
      setShowProblems(true)
      blocker.focus?.()
      return
    }

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
      pristine.current = fingerprint
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the expense')
    } finally {
      setBusy(false)
    }
  }

  const activeHint = SPLIT_TABS.find((t) => t.value === splitType)?.hint
  // Base UI renders the raw value in a closed select unless it is handed the
  // labels too — which is how "Paid by" came to read "u1".
  const categoryItems = CATEGORIES.map((c) => ({ value: c.value, label: c.label }))
  const memberItems = members.map((m) => ({
    value: m.id,
    label: m.id === currentUserId ? 'You' : displayName(m),
  }))
  const allSelected = members.length > 0 && members.every((m) => selected[m.id])
  const splitTotal = Object.values(preview.shares).reduce((sum, value) => sum + value, 0)

  return (
    <Dialog open={open} onOpenChange={(next) => void requestClose(next)}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <form onSubmit={submit} onKeyDown={submitOnMetaEnter} noValidate className="flex max-h-[92vh] flex-col">
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
                    ref={descriptionField}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Dinner at Cantina"
                    autoComplete="off"
                    autoFocus
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="expense-amount">Amount</Label>
                  <div className="flex gap-2">
                    <AmountInput
                      id="expense-amount"
                      ref={amountField}
                      value={amount}
                      onValueChange={setAmount}
                      placeholder="0.00"
                    />
                    <Select
                      value={currency}
                      onValueChange={(value) => setCurrency(value ?? '')}
                    >
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
                  {/* What this lands as on the balances, before it lands there. */}
                  {converted !== null ? (
                    <p className="text-xs text-muted-foreground">
                      ≈ {formatMoney(converted, group!.base_currency)} at the group's
                      rate of {rate}.
                    </p>
                  ) : null}
                  {group && currencyOptions.length === 1 ? (
                    <p className="text-xs text-muted-foreground">
                      Add a rate in group settings to spend in another currency.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="expense-date">Date</Label>
                  <div className="flex gap-2">
                    <Input
                      id="expense-date"
                      type="date"
                      className="flex-1"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                    {date !== today() ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDate(today())}
                      >
                        Today
                      </Button>
                    ) : null}
                  </div>
                  {futureDate ? (
                    <p className="text-xs text-amber-700 dark:text-amber-500">
                      That date is in the future. Fine if you meant it.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="expense-category">Category</Label>
                  <Select
                    items={categoryItems}
                    value={category}
                    onValueChange={(value) => setCategory(value ?? '')}
                  >
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
                  <Label htmlFor="expense-notes">
                    Notes <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id="expense-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={1}
                    placeholder="Anything worth remembering later"
                  />
                </div>
              </div>

              {group ? (
                <>
                  <Separator />

                  {/* ---------- who paid ---------- */}
                  <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
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
                              {member.id === currentUserId ? 'You' : displayName(member)}
                            </span>
                            <div className="w-32">
                              <AmountInput
                                value={payerAmounts[member.id] ?? ''}
                                onValueChange={(value) =>
                                  setPayerAmounts((current) => ({
                                    ...current,
                                    [member.id]: value,
                                  }))
                                }
                                placeholder="0.00"
                                aria-label={`Amount paid by ${displayName(member)}`}
                              />
                            </div>
                          </div>
                        ))}
                        <p
                          aria-live="polite"
                          className={
                            payerMismatch
                              ? 'text-xs text-destructive'
                              : 'text-xs text-muted-foreground'
                          }
                        >
                          Paid {formatMoney(paidSum, currency)} of{' '}
                          {formatMoney(total, currency)}
                          {payerMismatch
                            ? ` — ${formatMoney(Math.abs(total - paidSum), currency)} ${
                                paidSum > total ? 'too much' : 'still unaccounted for'
                              }.`
                            : ''}
                        </p>
                      </div>
                    ) : (
                      <Select
                        items={memberItems}
                        value={singlePayer}
                        onValueChange={(value) => setSinglePayer(value ?? '')}
                      >
                        <SelectTrigger className="w-full" aria-label="Who paid">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((member) => (
                            <SelectItem key={member.id} value={member.id}>
                              {member.id === currentUserId ? 'You' : displayName(member)}
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
                                aria-label={`Name of item ${index + 1}`}
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
                                inputMode="numeric"
                                placeholder="Qty"
                                aria-label={`Quantity of item ${index + 1}`}
                                value={item.quantity}
                                onChange={(e) =>
                                  setItems((current) =>
                                    current.map((it, i) =>
                                      i === index ? { ...it, quantity: e.target.value } : it,
                                    ),
                                  )
                                }
                              />
                              <div className="w-28">
                                <AmountInput
                                  value={item.amount}
                                  onValueChange={(value) =>
                                    setItems((current) =>
                                      current.map((it, i) =>
                                        i === index ? { ...it, amount: value } : it,
                                      ),
                                    )
                                  }
                                  placeholder="0.00"
                                  aria-label={`Price of item ${index + 1}`}
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  setItems((current) => current.filter((_, i) => i !== index))
                                }
                                aria-label={`Remove item ${index + 1}`}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted-foreground">Shared by</span>
                              {members.map((member) => {
                                const on = item.sharedWith.includes(member.id)
                                return (
                                  <button
                                    key={member.id}
                                    type="button"
                                    // A chip that toggles is a toggle, and has to
                                    // announce itself as one.
                                    aria-pressed={on}
                                    onClick={() => toggleItemPerson(index, member.id)}
                                    className={
                                      on
                                        ? 'rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground'
                                        : 'rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted'
                                    }
                                  >
                                    {member.id === currentUserId ? 'You' : displayName(member)}
                                  </button>
                                )
                              })}
                              {item.sharedWith.length === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  — nobody yet, so this line is split by everyone
                                </span>
                              ) : null}
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
                      <div className="rounded-lg border">
                        <div className="flex items-center justify-between border-b px-3 py-2">
                          <span className="text-xs text-muted-foreground">
                            {participants.length} of {members.length} sharing
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() =>
                              setSelected(
                                Object.fromEntries(
                                  members.map((m) => [m.id, !allSelected]),
                                ),
                              )
                            }
                          >
                            {allSelected ? 'Clear all' : 'Select everyone'}
                          </Button>
                        </div>
                        <div className="divide-y">
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
                                  className="w-24 tabular-nums"
                                  inputMode="decimal"
                                  aria-label={
                                    splitType === 'percent'
                                      ? `Percentage for ${displayName(member)}`
                                      : splitType === 'shares'
                                        ? `Shares for ${displayName(member)}`
                                        : `Exact amount for ${displayName(member)}`
                                  }
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
                        {/* The running total is the thing people check before
                            they trust a split. */}
                        {!preview.error && participants.length > 0 ? (
                          <p className="border-t px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">
                            Shares add up to {formatMoney(splitTotal, currency)}
                          </p>
                        ) : null}
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
                      <p className="text-xs text-destructive" role="alert">
                        {preview.error}
                      </p>
                    ) : null}
                  </section>
                </>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter className="mx-0 mb-0 flex-col items-stretch gap-3 border-t p-4 sm:flex-row sm:items-center">
            {/* Rather than greying the button out and leaving people guessing,
                say which field is holding it up. */}
            <p
              aria-live="polite"
              className={
                showProblems && blocker
                  ? 'flex-1 text-xs text-destructive'
                  : 'flex-1 text-xs text-muted-foreground'
              }
            >
              {showProblems && blocker
                ? blocker.message
                : isEdit
                  ? 'Saving recalculates the balances for everyone.'
                  : ''}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void requestClose(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {isEdit ? 'Save changes' : 'Add expense'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
