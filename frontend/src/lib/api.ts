import { devEmail, supabase } from './supabase'
import type {
  Activity,
  Balances,
  Expense,
  ExpenseInput,
  Group,
  GroupSummary,
  ImportPreview,
  ImportRequest,
  ImportResult,
  Invite,
  Money,
  Rate,
  Settlement,
  SettlementMethod,
  User,
} from '@/types'

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(
  /\/$/,
  '',
)

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** How long to wait before deciding the server is not going to answer. Without
 *  this a dead API leaves a spinner turning forever with nothing to act on. */
const TIMEOUT_MS = 20_000

/** `fetch` rejects with "Failed to fetch" for DNS, CORS, offline and a dozen
 *  other causes. None of those are a sentence a person can act on. */
function networkError(cause: unknown): ApiError {
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new ApiError(0, 'The server took too long to answer. Try again.')
  }
  if (!navigator.onLine) {
    return new ApiError(0, 'You are offline. Reconnect and try again.')
  }
  return new ApiError(0, 'Could not reach the server. Check your connection and try again.')
}

async function authHeader(): Promise<Record<string, string>> {
  if (devEmail) return { Authorization: `Dev ${devEmail}` }
  if (!supabase) return {}
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init
  const url = new URL(BASE_URL + path)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const timeout = AbortSignal.timeout
    ? AbortSignal.timeout(TIMEOUT_MS)
    : undefined

  let response: Response
  try {
    response = await fetch(url, {
      ...rest,
      signal: rest.signal ?? timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeader()),
        ...rest.headers,
      },
    })
  } catch (cause) {
    throw networkError(cause)
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let body: { detail?: unknown } | null = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // An HTML error page from a proxy, not the API. Fall through to the
    // status-based message below rather than showing the person raw markup.
  }

  if (!response.ok) {
    const detail = body?.detail
    const message =
      typeof detail === 'string' && detail
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg ?? '').filter(Boolean).join(', ')
          : STATUS_MESSAGES[response.status] ?? `Something went wrong (${response.status}).`
    throw new ApiError(response.status, message)
  }

  return body as T
}

/** Plain-language fallbacks for the statuses a person can actually hit. */
const STATUS_MESSAGES: Record<number, string> = {
  401: 'Your session expired. Sign in again.',
  403: 'You do not have access to that.',
  404: 'That is gone — someone may have deleted it.',
  409: 'Someone changed this while you were editing. Reload and try again.',
  429: 'Too many requests in a row. Wait a moment and try again.',
  500: 'The server hit an error. Try again in a moment.',
  502: 'The server is not responding. Try again in a moment.',
  503: 'The server is not responding. Try again in a moment.',
  504: 'The server took too long to answer. Try again.',
}

const json = (body: unknown) => ({ body: JSON.stringify(body) })

export const api = {
  me: () => request<User>('/me'),
  updateMe: (display_name: string) =>
    request<User>('/me', { method: 'PATCH', ...json({ display_name }) }),

  // --- groups -------------------------------------------------------------
  listGroups: () => request<GroupSummary[]>('/groups'),
  getGroup: (id: string) => request<Group>(`/groups/${id}`),
  createGroup: (body: { name: string; description: string; base_currency: string }) =>
    request<Group>('/groups', { method: 'POST', ...json(body) }),
  updateGroup: (
    id: string,
    body: Partial<{ name: string; description: string; base_currency: string }>,
  ) => request<Group>(`/groups/${id}`, { method: 'PATCH', ...json(body) }),
  deleteGroup: (id: string) => request<void>(`/groups/${id}`, { method: 'DELETE' }),
  removeMember: (groupId: string, userId: string) =>
    request<void>(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),

  // --- invites ------------------------------------------------------------
  listGroupInvites: (groupId: string) =>
    request<Invite[]>(`/groups/${groupId}/invites`),
  invite: (groupId: string, email: string) =>
    request<Invite>(`/groups/${groupId}/invites`, { method: 'POST', ...json({ email }) }),
  revokeInvite: (groupId: string, inviteId: string) =>
    request<void>(`/groups/${groupId}/invites/${inviteId}`, { method: 'DELETE' }),
  myInvites: () => request<Invite[]>('/invites'),
  acceptInvite: (inviteId: string) =>
    request<User>(`/invites/${inviteId}/accept`, { method: 'POST' }),
  declineInvite: (inviteId: string) =>
    request<void>(`/invites/${inviteId}/decline`, { method: 'POST' }),

  // --- rates --------------------------------------------------------------
  listRates: (groupId: string) => request<Rate[]>(`/groups/${groupId}/rates`),
  setRate: (groupId: string, currency: string, rate_to_base: Money) =>
    request<Rate>(`/groups/${groupId}/rates`, {
      method: 'PUT',
      ...json({ currency, rate_to_base }),
    }),
  deleteRate: (groupId: string, currency: string) =>
    request<void>(`/groups/${groupId}/rates/${currency}`, { method: 'DELETE' }),

  // --- expenses -----------------------------------------------------------
  listExpenses: (groupId: string, filters: { category?: string; q?: string } = {}) =>
    request<Expense[]>('/expenses', { query: { group_id: groupId, ...filters } }),
  listPersonalExpenses: () => request<Expense[]>('/expenses/personal'),
  getExpense: (id: string) => request<Expense>(`/expenses/${id}`),
  createExpense: (body: ExpenseInput) =>
    request<Expense>('/expenses', { method: 'POST', ...json(body) }),
  updateExpense: (id: string, body: Partial<ExpenseInput>) =>
    request<Expense>(`/expenses/${id}`, { method: 'PATCH', ...json(body) }),
  deleteExpense: (id: string) => request<void>(`/expenses/${id}`, { method: 'DELETE' }),

  // --- settlements --------------------------------------------------------
  listSettlements: (groupId: string) =>
    request<Settlement[]>('/settlements', { query: { group_id: groupId } }),
  recordSettlement: (
    groupId: string,
    body: {
      from_user_id: string
      to_user_id: string
      currency: string
      amount: Money
      method: SettlementMethod
      note: string
      settled_on: string
    },
  ) =>
    request<Settlement>('/settlements', {
      method: 'POST',
      query: { group_id: groupId },
      ...json(body),
    }),
  deleteSettlement: (id: string) =>
    request<void>(`/settlements/${id}`, { method: 'DELETE' }),

  // --- importing ----------------------------------------------------------
  previewSplitwise: (csv: string) =>
    request<ImportPreview>('/imports/splitwise/preview', {
      method: 'POST',
      ...json({ csv }),
    }),
  importSplitwise: (body: ImportRequest) =>
    request<ImportResult>('/imports/splitwise', { method: 'POST', ...json(body) }),

  // --- balances & activity ------------------------------------------------
  balances: (groupId: string) => request<Balances>(`/groups/${groupId}/balances`),
  activity: (groupId: string) => request<Activity[]>(`/groups/${groupId}/activity`),
}
