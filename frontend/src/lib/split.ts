/**
 * A client-side mirror of `backend/app/services/splits.py`, used only to preview
 * what each person will owe while the form is being filled in. The server still
 * recomputes and validates everything on submit.
 */
import { num } from './format'

const toCents = (value: number) => Math.round(value * 100)

/** Largest-remainder allocation, in cents, so the parts always sum to `total`. */
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []

  const cents = toCents(total)
  let sum = weights.reduce((a, b) => a + b, 0)
  let w = weights
  if (sum <= 0) {
    w = weights.map(() => 1)
    sum = n
  }

  const exact = w.map((weight) => (cents * weight) / sum)
  const floors = exact.map((value) => Math.floor(value))
  let remainder = cents - floors.reduce((a, b) => a + b, 0)

  const order = exact
    .map((value, index) => ({ index, frac: value - floors[index] }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index)

  for (let i = 0; remainder > 0; i += 1, remainder -= 1) {
    floors[order[i % n].index] += 1
  }

  return floors.map((c) => c / 100)
}

export interface PreviewItem {
  amount: string
  quantity: string
  sharedWith: string[]
}

export interface SplitPreview {
  shares: Record<string, number>
  error: string | null
}

export function previewSplit(
  splitType: string,
  total: number,
  participants: { userId: string; value: string }[],
  items: PreviewItem[] = [],
): SplitPreview {
  const empty = { shares: {} as Record<string, number>, error: null as string | null }
  if (!Number.isFinite(total) || total <= 0) return { ...empty, error: null }

  if (splitType === 'items') {
    if (items.length === 0) return { ...empty, error: 'Add at least one item.' }

    const subtotals: Record<string, number> = {}
    let itemsTotal = 0

    for (const item of items) {
      if (item.sharedWith.length === 0) {
        return { ...empty, error: 'Every item needs at least one person on it.' }
      }
      const line = Math.round(num(item.amount) * num(item.quantity || '1') * 100) / 100
      itemsTotal += line
      const parts = allocate(line, item.sharedWith.map(() => 1))
      item.sharedWith.forEach((userId, i) => {
        subtotals[userId] = (subtotals[userId] ?? 0) + parts[i]
      })
    }

    if (toCents(itemsTotal) > toCents(total)) {
      return {
        ...empty,
        error: `The items add up to ${itemsTotal.toFixed(2)}, more than the total.`,
      }
    }

    const ids = Object.keys(subtotals)
    const amounts = allocate(total, ids.map((id) => subtotals[id]))
    const shares: Record<string, number> = {}
    ids.forEach((id, i) => {
      shares[id] = amounts[i]
    })
    return { shares, error: null }
  }

  if (participants.length === 0) {
    return { ...empty, error: 'Pick at least one person to split with.' }
  }

  const ids = participants.map((p) => p.userId)
  const values = participants.map((p) => num(p.value))
  const shares: Record<string, number> = {}

  const assign = (amounts: number[]) => {
    ids.forEach((id, i) => {
      shares[id] = amounts[i]
    })
    return { shares, error: null }
  }

  switch (splitType) {
    case 'equal':
      return assign(allocate(total, ids.map(() => 1)))

    case 'exact': {
      const sum = values.reduce((a, b) => a + b, 0)
      if (toCents(sum) !== toCents(total)) {
        const diff = total - sum
        return {
          ...empty,
          error: `${diff > 0 ? `${diff.toFixed(2)} left to assign` : `${Math.abs(diff).toFixed(2)} over the total`}.`,
        }
      }
      return assign(allocate(total, values))
    }

    case 'percent': {
      const sum = values.reduce((a, b) => a + b, 0)
      if (Math.abs(sum - 100) > 0.01) {
        return { ...empty, error: `Percentages add up to ${sum}%, not 100%.` }
      }
      return assign(allocate(total, values))
    }

    case 'shares': {
      const sum = values.reduce((a, b) => a + b, 0)
      if (sum <= 0) return { ...empty, error: 'Give at least one person a share.' }
      return assign(allocate(total, values))
    }

    default:
      return empty
  }
}
