/** Money crosses the wire as a decimal string so cents never round-trip through
 *  a float. Parse it only for display or comparison. */
export type Money = string

export type SplitType = 'equal' | 'exact' | 'percent' | 'shares' | 'items'
export type SettlementMethod = 'in_app' | 'outside'

export interface User {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
}

export interface Member {
  user: User
  role: 'owner' | 'member'
  joined_at: string
}

export interface Rate {
  currency: string
  rate_to_base: Money
  updated_at: string
}

export interface Group {
  id: string
  name: string
  description: string
  base_currency: string
  created_by: string
  created_at: string
  members: Member[]
  rates: Rate[]
}

export interface GroupSummary {
  id: string
  name: string
  description: string
  base_currency: string
  member_count: number
  expense_count: number
  total_spend: Money
  your_net: Money
}

export interface Invite {
  id: string
  group_id: string
  group_name: string
  email: string
  status: string
  invited_by: User | null
  created_at: string
}

export interface Payer {
  user_id: string
  amount: Money
  amount_base: Money
}

export interface Split {
  user_id: string
  amount: Money
  amount_base: Money
  share_units: Money | null
  percent: Money | null
}

export interface ExpenseItem {
  id: string
  name: string
  amount: Money
  quantity: Money
  shared_with: string[]
}

export interface Expense {
  id: string
  group_id: string | null
  owner_id: string | null
  description: string
  notes: string
  category: string
  currency: string
  amount: Money
  rate_to_base: Money
  amount_base: Money
  expense_date: string
  split_type: SplitType
  created_by: string
  created_at: string
  updated_at: string
  payers: Payer[]
  splits: Split[]
  items: ExpenseItem[]
}

export interface Settlement {
  id: string
  group_id: string
  from_user_id: string
  to_user_id: string
  currency: string
  amount: Money
  rate_to_base: Money
  amount_base: Money
  method: SettlementMethod
  note: string
  settled_on: string
  created_by: string
  created_at: string
}

export interface BalanceRow {
  user: User
  paid: Money
  owed: Money
  settled_out: Money
  settled_in: Money
  net: Money
}

export interface Transfer {
  from_user_id: string
  to_user_id: string
  amount: Money
}

export interface Balances {
  group_id: string
  base_currency: string
  balances: BalanceRow[]
  pairwise: Transfer[]
  simplified: Transfer[]
  transfers_saved: number
  total_outstanding: Money
  missing_rates: string[]
}

export interface Activity {
  id: string
  group_id: string | null
  actor: User
  entity_type: string
  entity_id: string | null
  action: string
  summary: string
  details: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// Splitwise import
// ---------------------------------------------------------------------------
/** Nets are kept per currency: until the group has a rate, pesos and dollars
 *  cannot be added together. */
export type MoneyByCurrency = Record<string, Money>

export interface ImportPerson {
  name: string
  nets: MoneyByCurrency
  stated_nets: MoneyByCurrency
  suggested_email: string | null
}

export interface ImportCurrency {
  code: string
  count: number
}

export interface ImportEntry {
  line: number
  kind: 'expense' | 'settlement'
  expense_date: string | null
  description: string
  category: string
  source_category: string
  currency: string
  amount: Money
  split_type: string
  paid: Record<string, Money>
  owed: Record<string, Money>
  from_person: string | null
  to_person: string | null
  problem: string | null
}

export interface ImportPreview {
  people: ImportPerson[]
  currencies: ImportCurrency[]
  suggested_base_currency: string
  first_date: string | null
  last_date: string | null
  expense_count: number
  settlement_count: number
  skipped_count: number
  entries: ImportEntry[]
  warnings: string[]
}

export interface ImportRequest {
  csv: string
  group_id: string | null
  group_name: string
  description: string
  base_currency: string
  rates: { currency: string; rate_to_base: Money }[]
  people: { name: string; email: string }[]
}

export interface ImportResult {
  group_id: string
  group_name: string
  base_currency: string
  expenses_created: number
  settlements_created: number
  members_added: number
  duplicates_skipped: number
  rows_skipped: number
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------
export interface PayerInput {
  user_id: string
  amount: Money
}

export interface ParticipantInput {
  user_id: string
  value?: Money | null
}

export interface ItemInput {
  name: string
  amount: Money
  quantity: Money
  shared_with: string[]
}

export interface ExpenseInput {
  group_id: string | null
  description: string
  notes: string
  category: string
  currency: string
  amount: Money
  expense_date: string
  split_type: SplitType
  payers: PayerInput[]
  participants: ParticipantInput[]
  items: ItemInput[]
}
