import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Download, FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import { CURRENCIES, categoryIcon, formatDate, formatMoney, num } from '@/lib/format'
import type { GroupSummary, ImportPreview } from '@/types'

const NEW_GROUP = '__new__'

/** "lolos_2026-09-01_export.csv" is Splitwise's naming, and the group is the
 *  first part of it. */
function groupNameFromFile(filename: string): string {
  const stem = filename
    .replace(/\.csv$/i, '')
    .replace(/[_-]?\d{4}-\d{2}-\d{2}[_-]?/, ' ')
    .replace(/\bexport\b/i, ' ')
    .replace(/[_-]+/g, ' ')
    .trim()
  return stem.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase()) || 'Imported group'
}

interface Props {
  groups: GroupSummary[]
  currentUserEmail: string
  onImported: () => void
}

export function ImportSplitwiseDialog({
  groups,
  currentUserEmail,
  onImported,
}: Props) {
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [target, setTarget] = useState(NEW_GROUP)
  const [groupName, setGroupName] = useState('')
  const [baseCurrency, setBaseCurrency] = useState('USD')
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [rates, setRates] = useState<Record<string, string>>({})

  const existing = groups.find((g) => g.id === target)
  // Base UI shows the raw value in the trigger unless it is given the labels.
  const targetItems = [
    { value: NEW_GROUP, label: 'A new group' },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ]
  const base = existing ? existing.base_currency : baseCurrency
  const needsRates = (preview?.currencies ?? [])
    .map((c) => c.code)
    .filter((code) => code !== base)

  function reset() {
    setCsv('')
    setPreview(null)
    setError(null)
    setTarget(NEW_GROUP)
    setGroupName('')
    setEmails({})
    setRates({})
    if (fileInput.current) fileInput.current.value = ''
  }

  async function readFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      const text = await file.text()
      const result = await api.previewSplitwise(text)
      setCsv(text)
      setPreview(result)
      setGroupName(groupNameFromFile(file.name))
      setBaseCurrency(result.suggested_base_currency)
      setEmails(
        Object.fromEntries(
          result.people.map((p) => [p.name, p.suggested_email ?? '']),
        ),
      )
      setRates({})
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : 'Could not read that file')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!preview) return

    setBusy(true)
    try {
      const result = await api.importSplitwise({
        csv,
        group_id: existing ? existing.id : null,
        group_name: groupName.trim(),
        description: 'Imported from Splitwise',
        base_currency: base,
        rates: needsRates.map((code) => ({
          currency: code,
          rate_to_base: num(rates[code]).toString(),
        })),
        people: preview.people.map((p) => ({
          name: p.name,
          email: emails[p.name].trim(),
        })),
      })

      const bits = [`${result.expenses_created} expenses`]
      if (result.settlements_created) bits.push(`${result.settlements_created} repayments`)
      if (result.duplicates_skipped) bits.push(`${result.duplicates_skipped} already there`)
      toast.success(`Imported ${bits.join(', ')} into “${result.group_name}”`)

      // Anything the import decided that the preview could not know about, such
      // as a rate the target group already had.
      const news = result.warnings.filter((w) => !preview.warnings.includes(w))
      if (news.length) toast.warning(news.join(' '))

      setOpen(false)
      reset()
      onImported()
      navigate(`/groups/${result.group_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import failed')
    } finally {
      setBusy(false)
    }
  }

  const missingEmail = preview?.people.some((p) => !emails[p.name]?.trim())
  const missingRate = needsRates.some((code) => num(rates[code]) <= 0)
  const canSubmit =
    !!preview &&
    !busy &&
    !missingEmail &&
    !missingRate &&
    (!!existing || !!groupName.trim())

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Download className="size-4" aria-hidden />
        Import from Splitwise
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <form onSubmit={submit} className="flex max-h-[92vh] flex-col">
          <DialogHeader className="border-b p-6">
            <DialogTitle>Import from Splitwise</DialogTitle>
            <DialogDescription>
              In Splitwise, open the group, then{' '}
              <span className="font-medium">Export as spreadsheet</span>, and drop
              the CSV here. Nothing is written until you confirm.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="grid gap-5 p-6">
              <div className="grid gap-2">
                <Label htmlFor="import-file">Splitwise export</Label>
                <Input
                  id="import-file"
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void readFile(file)
                  }}
                />
              </div>

              {busy && !preview ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Reading the file…
                </p>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertTitle>That did not work</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {preview ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {preview.expense_count} expense
                    {preview.expense_count === 1 ? '' : 's'}
                    {preview.settlement_count
                      ? ` and ${preview.settlement_count} repayment${
                          preview.settlement_count === 1 ? '' : 's'
                        }`
                      : ''}{' '}
                    between {preview.people.length} people
                    {preview.first_date && preview.last_date
                      ? `, ${formatDate(preview.first_date)} to ${formatDate(
                          preview.last_date,
                        )}`
                      : ''}
                    .
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Import into</Label>
                      <Select
                        items={targetItems}
                        value={target}
                        onValueChange={(value) => setTarget(value ?? NEW_GROUP)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NEW_GROUP}>A new group</SelectItem>
                          {groups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {existing ? (
                      <div className="grid gap-2">
                        <Label>Base currency</Label>
                        <Input value={existing.base_currency} disabled />
                        <p className="text-xs text-muted-foreground">
                          Set by the group you are importing into.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-2">
                          <Label htmlFor="import-name">Group name</Label>
                          <Input
                            id="import-name"
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label>Base currency</Label>
                          <Select
                            value={baseCurrency}
                            onValueChange={(value) => setBaseCurrency(value ?? '')}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CURRENCIES.map((code) => (
                                <SelectItem key={code} value={code}>
                                  {code}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <Label>Who is who</Label>
                    <p className="text-xs text-muted-foreground">
                      Splitwise exports names, not addresses. Give each person
                      the email they sign in with — they become members straight
                      away and see the group the moment they sign in.
                    </p>
                    <div className="grid gap-2">
                      {preview.people.map((person) => (
                        <div
                          key={person.name}
                          className="grid items-center gap-2 sm:grid-cols-[1fr_1.4fr]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {person.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {Object.entries(person.nets)
                                .map(([code, value]) =>
                                  formatMoney(value, code, { signed: true }),
                                )
                                .join(' · ') || 'no balance'}
                            </p>
                          </div>
                          <Input
                            type="email"
                            required
                            placeholder={
                              person.suggested_email ?? 'name@example.com'
                            }
                            value={emails[person.name] ?? ''}
                            onChange={(e) =>
                              setEmails((prev) => ({
                                ...prev,
                                [person.name]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                    {!preview.people.some(
                      (p) =>
                        emails[p.name]?.trim().toLowerCase() ===
                        currentUserEmail.toLowerCase(),
                    ) ? (
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        None of these is your own address, so you will be in the
                        group with a zero balance.
                      </p>
                    ) : null}
                  </div>

                  {needsRates.length ? (
                    <div className="grid gap-2">
                      <Label>Exchange rates</Label>
                      <p className="text-xs text-muted-foreground">
                        The export mixes currencies. Rates are yours to set — this
                        app never fetches them — and you can change them later in
                        the group's settings.
                      </p>
                      {needsRates.map((code) => (
                        <div key={code} className="flex items-center gap-2 text-sm">
                          <span className="w-24 shrink-0">1 {code} =</span>
                          <Input
                            inputMode="decimal"
                            placeholder="0.00"
                            value={rates[code] ?? ''}
                            onChange={(e) =>
                              setRates((prev) => ({ ...prev, [code]: e.target.value }))
                            }
                          />
                          <span className="w-12 shrink-0">{base}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {preview.warnings.length ? (
                    <Alert>
                      <AlertTriangle className="size-4" aria-hidden />
                      <AlertTitle>
                        {preview.skipped_count
                          ? `${preview.skipped_count} row${
                              preview.skipped_count === 1 ? '' : 's'
                            } will be skipped`
                          : 'Worth a look'}
                      </AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc space-y-1 pl-4">
                          {preview.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="grid gap-2">
                    <Label>What will be created</Label>
                    <div className="rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-28">Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Paid by</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.entries.map((entry) => (
                            <TableRow
                              key={entry.line}
                              className={entry.problem ? 'opacity-50' : undefined}
                            >
                              <TableCell className="text-muted-foreground">
                                {entry.expense_date
                                  ? formatDate(entry.expense_date)
                                  : '—'}
                              </TableCell>
                              <TableCell>
                                <span className="mr-1" aria-hidden>
                                  {entry.kind === 'settlement'
                                    ? '💸'
                                    : categoryIcon(entry.category)}
                                </span>
                                {entry.description}
                                {entry.problem ? (
                                  <span className="block text-xs text-destructive">
                                    skipped — {entry.problem}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {entry.kind === 'settlement'
                                  ? `${entry.from_person} → ${entry.to_person}`
                                  : Object.keys(entry.paid).join(', ')}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatMoney(entry.amount, entry.currency)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter className="mx-0 mb-0 border-t p-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy && preview ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileUp className="size-4" aria-hidden />
              )}
              {preview
                ? `Import ${preview.expense_count + preview.settlement_count} rows`
                : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
