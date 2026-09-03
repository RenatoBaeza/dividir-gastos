import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Download, FileUp, Loader2, Upload, UserCheck } from 'lucide-react'
import { toast } from 'sonner'

import { AmountInput } from '@/components/AmountInput'
import { useConfirm } from '@/components/ConfirmDialog'
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
import {
  CURRENCIES,
  categoryIcon,
  formatDate,
  formatMoney,
  looksLikeEmail,
  num,
  pluralize,
} from '@/lib/format'
import { cn } from '@/lib/utils'
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

export function ImportSplitwiseDialog({ groups, currentUserEmail, onImported }: Props) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const fileInput = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

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
    setFileName('')
    setPreview(null)
    setError(null)
    setTarget(NEW_GROUP)
    setGroupName('')
    setEmails({})
    setRates({})
    setDragging(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function readFile(file: File) {
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setError(`“${file.name}” is not a CSV. In Splitwise, use Export as spreadsheet.`)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const text = await file.text()
      const result = await api.previewSplitwise(text)
      setCsv(text)
      setFileName(file.name)
      setPreview(result)
      setGroupName(groupNameFromFile(file.name))
      setBaseCurrency(result.suggested_base_currency)
      setEmails(
        Object.fromEntries(result.people.map((p) => [p.name, p.suggested_email ?? ''])),
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

    if (blocker) {
      toast.error(blocker)
      return
    }

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
          email: (emails[p.name] ?? '').trim(),
        })),
      })

      const bits = [pluralize(result.expenses_created, 'expense')]
      if (result.settlements_created)
        bits.push(pluralize(result.settlements_created, 'repayment'))
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

  const badEmail = preview?.people.find((p) => !looksLikeEmail(emails[p.name] ?? ''))
  const missingRate = needsRates.find((code) => num(rates[code]) <= 0)
  const meMapped = preview?.people.some(
    (p) => (emails[p.name] ?? '').trim().toLowerCase() === currentUserEmail.toLowerCase(),
  )

  /** One sentence naming the next thing to do, instead of a dead button. */
  const blocker = !preview
    ? 'Choose a Splitwise CSV first.'
    : !existing && !groupName.trim()
      ? 'Give the new group a name.'
      : badEmail
        ? `Add a valid email address for ${badEmail.name}.`
        : missingRate
          ? `Set the ${missingRate} exchange rate.`
          : null

  async function requestClose(next: boolean) {
    if (next) {
      setOpen(true)
      return
    }
    if (busy) return

    if (preview) {
      const ok = await confirm({
        title: 'Discard this import?',
        description: 'Nothing has been written yet. You would need to pick the file again.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep going',
        destructive: true,
      })
      if (!ok) return
    }
    setOpen(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => void requestClose(next)}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Download className="size-4" aria-hidden />
        Import from Splitwise
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <form onSubmit={submit} noValidate className="flex max-h-[92vh] flex-col">
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
              {/* The description promised a drop target, so this is one. */}
              <div
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  const file = event.dataTransfer.files?.[0]
                  if (file) void readFile(file)
                }}
                className={cn(
                  'grid gap-3 rounded-lg border-2 border-dashed p-5 text-center transition-colors',
                  dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
                )}
              >
                <Upload className="mx-auto size-6 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-sm font-medium">
                    {fileName || 'Drop the Splitwise CSV here'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fileName ? 'Drop another file to start over.' : 'or choose it below'}
                  </p>
                </div>
                <Label htmlFor="import-file" className="sr-only">
                  Splitwise export
                </Label>
                <Input
                  id="import-file"
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  className="mx-auto max-w-xs"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void readFile(file)
                  }}
                />
              </div>

              {busy && !preview ? (
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
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
                    {pluralize(preview.expense_count, 'expense')}
                    {preview.settlement_count
                      ? ` and ${pluralize(preview.settlement_count, 'repayment')}`
                      : ''}{' '}
                    between {preview.people.length} people
                    {preview.first_date && preview.last_date
                      ? `, ${formatDate(preview.first_date)} to ${formatDate(preview.last_date)}`
                      : ''}
                    .
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="import-target">Import into</Label>
                      <Select
                        items={targetItems}
                        value={target}
                        onValueChange={(value) => setTarget(value ?? NEW_GROUP)}
                      >
                        <SelectTrigger id="import-target" className="w-full">
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
                        <Label htmlFor="import-existing-currency">Base currency</Label>
                        <Input
                          id="import-existing-currency"
                          value={existing.base_currency}
                          readOnly
                        />
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
                            aria-invalid={groupName.trim() ? undefined : true}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="import-currency">Base currency</Label>
                          <Select
                            value={baseCurrency}
                            onValueChange={(value) => setBaseCurrency(value ?? '')}
                          >
                            <SelectTrigger id="import-currency" className="w-full">
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
                      Splitwise exports names, not addresses. Give each person the
                      email they sign in with — they become members straight away
                      and see the group the moment they sign in.
                    </p>
                    <div className="grid gap-2">
                      {preview.people.map((person) => {
                        const value = emails[person.name] ?? ''
                        const isMe =
                          value.trim().toLowerCase() === currentUserEmail.toLowerCase()
                        return (
                          <div
                            key={person.name}
                            className="grid items-center gap-2 sm:grid-cols-[1fr_1.4fr]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{person.name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {Object.entries(person.nets)
                                  .map(([code, v]) => formatMoney(v, code, { signed: true }))
                                  .join(' · ') || 'no balance'}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Input
                                type="email"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                aria-label={`Email address for ${person.name}`}
                                aria-invalid={
                                  value && !looksLikeEmail(value) ? true : undefined
                                }
                                placeholder={person.suggested_email ?? 'name@example.com'}
                                value={value}
                                onChange={(e) =>
                                  setEmails((prev) => ({
                                    ...prev,
                                    [person.name]: e.target.value,
                                  }))
                                }
                              />
                              {/* Typing your own address once per import is the
                                  most repeated keystroke on this screen. */}
                              {currentUserEmail && !meMapped ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  aria-label={`This is me — use ${currentUserEmail}`}
                                  title={`This is me (${currentUserEmail})`}
                                  onClick={() =>
                                    setEmails((prev) => ({
                                      ...prev,
                                      [person.name]: currentUserEmail,
                                    }))
                                  }
                                >
                                  <UserCheck className="size-4" aria-hidden />
                                </Button>
                              ) : null}
                              {isMe ? (
                                <span className="grid w-9 shrink-0 place-items-center text-xs text-muted-foreground">
                                  you
                                </span>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {!meMapped ? (
                      <p className="text-xs text-amber-700 dark:text-amber-500">
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
                          <AmountInput
                            value={rates[code] ?? ''}
                            onValueChange={(value) =>
                              setRates((prev) => ({ ...prev, [code]: value }))
                            }
                            placeholder="0.00"
                            aria-label={`Value of 1 ${code} in ${base}`}
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
                          ? `${pluralize(preview.skipped_count, 'row')} will be skipped`
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
                    <div className="max-h-80 overflow-auto rounded-lg border">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background">
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
                                {entry.expense_date ? formatDate(entry.expense_date) : '—'}
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

          <DialogFooter className="mx-0 mb-0 flex-col items-stretch gap-3 border-t p-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-xs text-muted-foreground" aria-live="polite">
              {blocker ?? 'Nothing has been written yet.'}
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
              <Button type="submit" disabled={busy || !preview}>
                {busy && preview ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <FileUp className="size-4" aria-hidden />
                )}
                {preview
                  ? `Import ${preview.expense_count + preview.settlement_count} rows`
                  : 'Import'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
