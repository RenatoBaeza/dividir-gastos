import { useMemo, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Search, Trash2, Wallet, X } from 'lucide-react'

import { useAuth } from '@/auth/AuthProvider'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { ExpenseDialog } from '@/components/ExpenseDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Kbd } from '@/components/Kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import {
  categoryIcon,
  categoryLabel,
  formatDate,
  formatDateRelative,
  formatMoney,
  num,
  pluralize,
} from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useHotkey } from '@/lib/useHotkey'
import { useRevalidateOnFocus } from '@/lib/useRevalidate'
import { useUndoableDelete } from '@/lib/useUndoableDelete'
import type { Expense } from '@/types'

export default function PersonalPage() {
  const { user } = useAuth()
  const expenses = useAsync(() => api.listPersonalExpenses(), [])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [query, setQuery] = useState('')
  const searchField = useRef<HTMLInputElement>(null)

  useDocumentTitle('Personal expenses')
  useRevalidateOnFocus(() => void expenses.reload())
  useHotkey('n', () => openNew())
  useHotkey('/', () => searchField.current?.focus())

  const all = useMemo(() => expenses.data ?? [], [expenses.data])

  const deletion = useUndoableDelete({
    perform: (id) => api.deleteExpense(id),
    describe: (id) => {
      const expense = all.find((e) => e.id === id)
      return expense ? `Deleted “${expense.description}”` : 'Expense deleted'
    },
    onDone: () => void expenses.reload(),
  })
  const { isPending } = deletion

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return all.filter((expense) => {
      if (isPending(expense.id)) return false
      if (!needle) return true
      return (
        expense.description.toLowerCase().includes(needle) ||
        expense.notes.toLowerCase().includes(needle) ||
        categoryLabel(expense.category).toLowerCase().includes(needle)
      )
    })
  }, [all, query, isPending])

  const byCurrency = useMemo(() => {
    const totals = new Map<string, number>()
    for (const expense of visible) {
      totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + num(expense.amount))
    }
    return [...totals.entries()]
  }, [visible])

  function openNew() {
    setEditing(null)
    setDialogOpen(true)
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
        <Tooltip>
          <TooltipTrigger render={<Button onClick={openNew} />}>
            <Plus className="size-4" aria-hidden />
            Add expense
          </TooltipTrigger>
          <TooltipContent>
            Press <Kbd>N</Kbd>, or <Kbd>/</Kbd> to search
          </TooltipContent>
        </Tooltip>
      </div>

      {expenses.error ? (
        <ErrorState
          title="Could not load your expenses"
          message={expenses.error}
          onRetry={() => void expenses.reload()}
          retrying={expenses.refreshing}
        />
      ) : null}

      {expenses.loading ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
          <span className="sr-only" role="status">
            Loading your expenses…
          </span>
        </>
      ) : null}

      {byCurrency.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {byCurrency.map(([currency, total]) => (
            <Card key={currency}>
              <CardHeader className="pb-2">
                <CardDescription>
                  {query.trim() ? 'Matching total' : 'Total'} in {currency}
                </CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {formatMoney(total, currency)}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}

      {all.length > 0 ? (
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
              aria-label="Search your personal expenses"
              placeholder="Search expenses…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {query.trim() ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                <X className="size-4" aria-hidden />
                Clear
              </Button>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {pluralize(visible.length, 'match', 'matches')} of {all.length}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {expenses.data && all.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nothing tracked yet"
          description="Use this for spending you do not share with anyone — it stays private and never reaches a group."
          action={
            <Button onClick={openNew}>
              <Plus className="size-4" aria-hidden />
              Add your first expense
            </Button>
          }
        />
      ) : null}

      {all.length > 0 && visible.length === 0 ? (
        <EmptyState
          compact
          icon={Search}
          title={`Nothing matches “${query.trim()}”`}
          action={
            <Button variant="outline" onClick={() => setQuery('')}>
              Clear the search
            </Button>
          }
        />
      ) : null}

      {visible.length > 0 ? (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y">
            {visible.map((expense) => (
              <li
                key={expense.id}
                className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-within:bg-muted/40 sm:gap-4"
              >
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-lg"
                  aria-hidden
                >
                  {categoryIcon(expense.category)}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(expense)
                      setDialogOpen(true)
                    }}
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
                    <time dateTime={expense.expense_date} title={formatDate(expense.expense_date)}>
                      {formatDateRelative(expense.expense_date)}
                    </time>
                    {expense.notes ? ` · ${expense.notes}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatMoney(expense.amount, expense.currency)}
                </span>
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
                      onClick={() => deletion.remove(expense.id)}
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
