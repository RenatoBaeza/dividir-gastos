import { useMemo, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Receipt, Search, Trash2, X } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { ExpenseDialog } from '@/components/ExpenseDialog'
import { MoneyDelta, TONE, directionOf } from '@/components/MoneyDelta'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Kbd } from '@/components/Kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import {
  CATEGORIES,
  categoryIcon,
  categoryLabel,
  displayName,
  formatDate,
  formatDateRelative,
  formatMoney,
  num,
  pluralize,
} from '@/lib/format'
import { useHotkey } from '@/lib/useHotkey'
import { useUndoableDelete } from '@/lib/useUndoableDelete'
import type { Expense, Group } from '@/types'

/** A first page long enough that nobody has to click, short enough that a
 *  group with a thousand expenses still paints instantly. */
const PAGE = 50

interface Props {
  group: Group
  expenses: Expense[]
  currentUserId: string
  onChanged: () => void
}

export function ExpensesTab({ group, expenses, currentUserId, onChanged }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const searchField = useRef<HTMLInputElement>(null)

  const deletion = useUndoableDelete({
    perform: (id) => api.deleteExpense(id),
    describe: (id) => {
      const expense = expenses.find((e) => e.id === id)
      return expense ? `Deleted “${expense.description}”` : 'Expense deleted'
    },
    onDone: onChanged,
  })

  useHotkey('/', () => searchField.current?.focus())
  useHotkey('n', () => openNew())

  const nameOf = useMemo(() => {
    const map = new Map(group.members.map((m) => [m.user.id, m.user]))
    return (id: string) => {
      const person = map.get(id)
      if (!person) return 'a former member'
      return person.id === currentUserId ? 'You' : displayName(person)
    }
  }, [group.members, currentUserId])

  const { isPending } = deletion
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = expenses.filter((expense) => {
      if (isPending(expense.id)) return false
      if (category !== 'all' && expense.category !== category) return false
      if (!needle) return true
      // People search for what they remember: the note they wrote, the person
      // who paid, or the amount — not only the description.
      return (
        expense.description.toLowerCase().includes(needle) ||
        expense.notes.toLowerCase().includes(needle) ||
        expense.amount.includes(needle) ||
        expense.payers.some((p) => nameOf(p.user_id).toLowerCase().includes(needle))
      )
    })

    // Newest first, so the day headings below always run in one direction
    // whatever order the API happened to hand them over in.
    return matched
      .slice()
      .sort((a, b) => b.expense_date.localeCompare(a.expense_date))
  }, [expenses, query, category, isPending, nameOf])

  /** Runs of expenses under one date heading, the way a bank statement reads. */
  const days = useMemo(() => {
    const groups: { date: string; items: Expense[] }[] = []
    for (const expense of visible.slice(0, limit)) {
      const last = groups[groups.length - 1]
      if (last && last.date === expense.expense_date) last.items.push(expense)
      else groups.push({ date: expense.expense_date, items: [expense] })
    }
    return groups
  }, [visible, limit])

  const filtered = query.trim() !== '' || category !== 'all'
  const shownTotal = useMemo(
    () => visible.reduce((sum, expense) => sum + num(expense.amount_base), 0),
    [visible],
  )

  function openNew() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(expense: Expense) {
    setEditing(expense)
    setDialogOpen(true)
  }

  const categoryItems = [
    { value: 'all', label: 'All categories' },
    ...CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
  ]

  function clearFilters() {
    setQuery('')
    setCategory('all')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs sm:flex-none">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchField}
            type="search"
            className="pl-9"
            aria-label="Search expenses by description, note, amount or who paid"
            placeholder="Search expenses…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
          />
        </div>

        <Select
          items={categoryItems}
          value={category}
          onValueChange={(value) => {
            setCategory(value ?? 'all')
            setLimit(PAGE)
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtered ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-4" aria-hidden />
            Clear
          </Button>
        ) : null}

        <Tooltip>
          <TooltipTrigger render={<Button className="ml-auto" onClick={openNew} />}>
            <Plus className="size-4" aria-hidden />
            Add expense
          </TooltipTrigger>
          <TooltipContent>
            Press <Kbd>N</Kbd>, or <Kbd>/</Kbd> to search
          </TooltipContent>
        </Tooltip>
      </div>

      {/* A running count and total, so a filter tells you something rather than
          just hiding rows. */}
      {visible.length > 0 ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pluralize(visible.length, 'expense')}
          {filtered ? ` matching (of ${expenses.length})` : ''} ·{' '}
          {formatMoney(shownTotal, group.base_currency)} total
        </p>
      ) : null}

      {visible.length === 0 ? (
        filtered ? (
          <EmptyState
            compact
            icon={Search}
            title="Nothing matches those filters"
            description="Try a different search term or category."
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear the filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Receipt}
            title="No expenses yet"
            description="Add the first one and the balances will follow."
            action={
              <Button onClick={openNew}>
                <Plus className="size-4" aria-hidden />
                Add the first expense
              </Button>
            }
          />
        )
      ) : (
        <div className="space-y-4">
          {days.map(({ date, items }) => (
            <div key={date}>
              <h3 className="sticky top-14 z-10 -mx-1 bg-muted/30 px-1 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
                <time dateTime={date} title={formatDate(date)}>
                  {formatDateRelative(date)}
                </time>
              </h3>
              <Card className="overflow-hidden py-0">
                <ul className="divide-y">
                  {items.map((expense) => (
                    <ExpenseRow
                      key={expense.id}
                      expense={expense}
                      group={group}
                      currentUserId={currentUserId}
                      nameOf={nameOf}
                      onEdit={() => openEdit(expense)}
                      onDelete={() => deletion.remove(expense.id)}
                    />
                  ))}
                </ul>
              </Card>
            </div>
          ))}

          {visible.length > limit ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLimit((current) => current + PAGE)}
            >
              Show {Math.min(PAGE, visible.length - limit)} more of {visible.length}
            </Button>
          ) : null}
        </div>
      )}

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        group={group}
        expense={editing}
        currentUserId={currentUserId}
        onSaved={onChanged}
      />
    </div>
  )
}

function ExpenseRow({
  expense,
  group,
  currentUserId,
  nameOf,
  onEdit,
  onDelete,
}: {
  expense: Expense
  group: Group
  currentUserId: string
  nameOf: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  const myShare = expense.splits.find((s) => s.user_id === currentUserId)
  const iPaid = expense.payers.find((p) => p.user_id === currentUserId)
  const lent = num(iPaid?.amount ?? 0) - num(myShare?.amount ?? 0)
  const direction = directionOf(lent)

  const paidBy =
    expense.payers.length === 1
      ? `${nameOf(expense.payers[0].user_id)} paid`
      : `${expense.payers.length} people paid`

  return (
    <li className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-within:bg-muted/40 sm:gap-4">
      <span
        className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-lg"
        aria-hidden
      >
        {categoryIcon(expense.category)}
      </span>

      <div className="min-w-0 flex-1">
        {/* The whole row opens the editor; the menu below sits above it. */}
        <button
          type="button"
          onClick={onEdit}
          className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{expense.description}</span>
            <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
              {categoryLabel(expense.category)}
            </Badge>
          </span>
          <span className="sr-only"> — edit this expense</span>
        </button>
        <p className="truncate text-xs text-muted-foreground">
          {paidBy} {formatMoney(expense.amount, expense.currency)}
          {expense.currency !== group.base_currency
            ? ` (${formatMoney(expense.amount_base, group.base_currency)})`
            : ''}
        </p>
        {/* On a phone the right-hand column has nowhere to go, and "what is
            this one costing me" is the reason the row is being read at all. */}
        <p className={`mt-0.5 text-xs sm:hidden ${TONE[direction]}`}>
          {direction === 'neutral' ? (
            'not involved'
          ) : (
            <MoneyDelta
              amount={lent}
              currency={expense.currency}
              showLabel
              labels={['you lent', 'you owe', 'not involved']}
              className="text-xs"
            />
          )}
        </p>
      </div>

      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-xs text-muted-foreground">
          {direction === 'positive'
            ? 'you lent'
            : direction === 'negative'
              ? 'you owe'
              : 'not involved'}
        </p>
        <p className={`text-sm font-medium tabular-nums ${TONE[direction]}`}>
          {direction === 'neutral' ? '—' : formatMoney(Math.abs(lent), expense.currency)}
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="relative z-10 shrink-0"
              aria-label={`Actions for ${expense.description}`}
            />
          }
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-4" aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
