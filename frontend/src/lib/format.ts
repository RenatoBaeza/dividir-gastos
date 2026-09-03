export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN', 'CAD',
  'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'JPY', 'CNY',
  'KRW', 'INR', 'SGD', 'HKD', 'THB', 'VND', 'IDR', 'PHP', 'MYR', 'ZAR',
  'TRY', 'AED', 'ILS', 'EGP', 'NGN', 'KES',
] as const

export const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'food', label: 'Food & drink' },
  { value: 'groceries', label: 'Groceries' },
  { value: 'rent', label: 'Rent' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'transport', label: 'Transport' },
  { value: 'travel', label: 'Travel' },
  { value: 'lodging', label: 'Lodging' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'health', label: 'Health' },
  { value: 'gifts', label: 'Gifts' },
  { value: 'other', label: 'Other' },
] as const

const CATEGORY_ICONS: Record<string, string> = {
  general: '🧾',
  food: '🍽️',
  groceries: '🛒',
  rent: '🏠',
  utilities: '💡',
  transport: '🚕',
  travel: '✈️',
  lodging: '🛏️',
  entertainment: '🎬',
  shopping: '🛍️',
  health: '💊',
  gifts: '🎁',
  other: '📦',
}

/** Currencies that are not divided into hundredths. Showing "¥1,200.00" is
 *  wrong in the same way "$12" is: it reads as a different amount. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'IDR'])

export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2
}

export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? CATEGORY_ICONS.general
}

export function categoryLabel(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.label ?? category
}

export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** True when the text is a number we can accept as money — used to tell an
 *  empty field apart from a field holding "12,50" or "abc". */
export function isAmountLike(value: string): boolean {
  return /^\d*([.,]\d*)?$/.test(value.trim())
}

export function formatMoney(
  value: string | number | null | undefined,
  currency: string,
  opts: { signed?: boolean } = {},
): string {
  const amount = num(value)
  const digits = currencyDecimals(currency)
  let formatted: string
  try {
    formatted = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Math.abs(amount))
  } catch {
    // An unknown ISO code would otherwise throw and blank the whole screen.
    formatted = `${Math.abs(amount).toFixed(digits)} ${currency}`
  }

  if (opts.signed && amount > 0) return `+${formatted}`
  if (amount < 0) return `-${formatted}`
  return formatted
}

/** Two decimals, no currency symbol - for inputs and rate tables. */
export function toAmountString(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

function parseDay(iso: string): Date {
  return new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
}

/** Whole days between a date and today, in the reader's own timezone. */
function daysAgo(date: Date): number {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round(
    (startOf(new Date()).getTime() - startOf(date).getTime()) / 86_400_000,
  )
}

export function formatDate(iso: string): string {
  const date = parseDay(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    // A year is noise until it is not the current one.
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

/** "Today" and "Yesterday" are how people actually talk about recent spending. */
export function formatDateRelative(iso: string): string {
  const date = parseDay(iso)
  if (Number.isNaN(date.getTime())) return iso
  const days = daysAgo(date)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days === -1) return 'Tomorrow'
  if (days > 1 && days < 7) return `${days} days ago`
  return formatDate(iso)
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  const days = daysAgo(date)
  if (days === 0) return `Today at ${time}`
  if (days === 1) return `Yesterday at ${time}`
  return `${formatDate(iso)} at ${time}`
}

/** Full, unambiguous timestamp — for the `title` of an abbreviated one. */
export function formatDateTimeFull(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export function today(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function initials(name: string, email: string): string {
  const source = name.trim() || email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase()
}

export function displayName(user: { display_name: string; email: string }): string {
  return user.display_name.trim() || user.email
}

/** Deliberately permissive: the server and the mail provider are the real
 *  authorities. This only catches the obvious typo before a round trip. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
