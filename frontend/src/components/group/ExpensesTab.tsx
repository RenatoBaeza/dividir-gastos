import { useMemo, useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ExpenseDialog } from '@/components/ExpenseDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { api } from '@/lib/api'
import {
  CATEGORIES,
  categoryIcon,
  categoryLabel,
  displayName,
  formatDate,
  formatMoney,
  num,
} from '@/lib/format'
import type { Expense, Group } from '@/types'

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

  const nameOf = useMemo(() => {
    const map = new Map(group.members.map((m) => [m.user.id, m.user]))
    return (id: string) => {
      const person = map.get(id)
      if (!person) return 'a former member'
      return person.id === currentUserId ? 'You' : displayName(person)
    }
  }, [group.members, currentUserId])

  const visible = expenses.filter((expense) => {
    if (category !== 'all' && expense.category !== category) return false
    if (!query.trim()) return true
    return expense.description.toLowerCase().includes(query.trim().toLowerCase())
  })

  async function remove(expense: Expense) {
    if (!window.confirm(`Delete “${expense.description}”?`)) return
    try {
      await api.deleteExpense(expense.id)
      toast.success('Expense deleted')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the expense')
    }
  }

  function openNew() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(expense: Expense) {
    setEditing(expense)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search expenses…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select value={category} onValueChange={(value) => setCategory(value ?? '')}>
          <SelectTrigger className="w-44">
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
        <Button className="ml-auto" onClick={openNew}>
          <Plus className="size-4" aria-hidden />
          Add expense
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted">
              <Receipt className="size-5 text-muted-foreground" aria-hidden />
            </span>
            <div>
              <p className="font-medium">
                {expenses.length === 0 ? 'No expenses yet' : 'Nothing matches that filter'}
              </p>
              <p className="text-sm text-muted-foreground">
                {expenses.length === 0
                  ? 'Add the first one and the balances will follow.'
                  : 'Try a different search or category.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y">
            {visible.map((expense) => {
              const myShare = expense.splits.find((s) => s.user_id === currentUserId)
              const iPaid = expense.payers.find((p) => p.user_id === currentUserId)
              const lent = num(iPaid?.amount ?? 0) - num(myShare?.amount ?? 0)

              return (
                <li
                  key={expense.id}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40"
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-lg"
                    aria-hidden
                  >
                    {categoryIcon(expense.category)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{expense.description}</p>
                      <Badge variant="secondary" className="hidden sm:inline-flex">
                        {categoryLabel(expense.category)}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDate(expense.expense_date)} ·{' '}
                      {expense.payers.length === 1
                        ? `${nameOf(expense.payers[0].user_id)} paid`
                        : `${expense.payers.length} people paid`}{' '}
                      {formatMoney(expense.amount, expense.currency)}
                      {expense.currency !== group.base_currency
                        ? ` (${formatMoney(expense.amount_base, group.base_currency)})`
                        : ''}
                    </p>
                  </div>

                  <div className="hidden text-right sm:block">
                    <p className="text-xs text-muted-foreground">
                      {lent > 0 ? 'you lent' : lent < 0 ? 'you owe' : 'not involved'}
                    </p>
                    <p
                      className={
                        lent > 0
                          ? 'text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400'
                          : lent < 0
                            ? 'text-sm font-medium tabular-nums text-rose-600 dark:text-rose-400'
                            : 'text-sm font-medium tabular-nums text-muted-foreground'
                      }
                    >
                      {lent === 0
                        ? '—'
                        : formatMoney(Math.abs(lent), expense.currency)}
                    </p>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon" aria-label="Expense actions" />
                      }
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(expense)}>
                        <Pencil className="size-4" aria-hidden />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void remove(expense)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>
        </Card>
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
