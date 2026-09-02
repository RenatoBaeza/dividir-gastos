import { useMemo, useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/auth/AuthProvider'
import { ExpenseDialog } from '@/components/ExpenseDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import {
  categoryIcon,
  categoryLabel,
  formatDate,
  formatMoney,
  num,
} from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import type { Expense } from '@/types'

export default function PersonalPage() {
  const { user } = useAuth()
  const expenses = useAsync(() => api.listPersonalExpenses(), [])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)

  const byCurrency = useMemo(() => {
    const totals = new Map<string, number>()
    for (const expense of expenses.data ?? []) {
      totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + num(expense.amount))
    }
    return [...totals.entries()]
  }, [expenses.data])

  async function remove(expense: Expense) {
    if (!window.confirm(`Delete “${expense.description}”?`)) return
    try {
      await api.deleteExpense(expense.id)
      toast.success('Expense deleted')
      await expenses.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the expense')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Personal expenses</h1>
          <p className="text-sm text-muted-foreground">
            Only you can see these. They never touch a group balance.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="size-4" aria-hidden />
          Add expense
        </Button>
      </div>

      {byCurrency.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {byCurrency.map(([currency, total]) => (
            <Card key={currency}>
              <CardHeader className="pb-2">
                <CardDescription>Total in {currency}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {formatMoney(total, currency)}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}

      {expenses.loading && !expenses.data ? <Skeleton className="h-48 rounded-xl" /> : null}

      {expenses.data?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted">
              <Wallet className="size-5 text-muted-foreground" aria-hidden />
            </span>
            <div>
              <p className="font-medium">Nothing tracked yet</p>
              <p className="text-sm text-muted-foreground">
                Use this for spending you do not share with anyone.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {expenses.data?.length ? (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y">
            {expenses.data.map((expense) => (
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
                  <p className="text-xs text-muted-foreground">
                    {formatDate(expense.expense_date)}
                    {expense.notes ? ` · ${expense.notes}` : ''}
                  </p>
                </div>
                <span className="text-sm font-medium tabular-nums">
                  {formatMoney(expense.amount, expense.currency)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon" aria-label="Expense actions" />
                    }
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditing(expense)
                        setDialogOpen(true)
                      }}
                    >
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
            ))}
          </ul>
        </Card>
      ) : null}

      {user ? (
        <ExpenseDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          group={null}
          expense={editing}
          currentUserId={user.id}
          onSaved={() => void expenses.reload()}
        />
      ) : null}
    </div>
  )
}
