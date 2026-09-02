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

export function formatMoney(
  value: string | number | null | undefined,
  currency: string,
  opts: { signed?: boolean } = {},
): string {
  const amount = num(value)
  const formatted = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))

  if (opts.signed && amount > 0) return `+${formatted}`
  if (amount < 0) return `-${formatted}`
  return formatted
}

/** Two decimals, no currency symbol - for inputs and rate tables. */
export function toAmountString(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

export function formatDate(iso: string): string {
  return new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(
    undefined,
    { day: 'numeric', month: 'short', year: 'numeric' },
  )
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
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
