import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Local development can run against `AUTH_DEV_MODE` on the API instead of a
 *  real Supabase project. When this is set, Supabase is never contacted. */
export const devEmail: string | null =
  import.meta.env.VITE_AUTH_DEV_EMAIL?.trim() || null

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

export const authConfigured = Boolean(supabase) || Boolean(devEmail)

function client(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured. See frontend/.env.example.')
  return supabase
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) throw new Error(friendly(error.message))
}

export interface SignUpResult {
  /** True when Supabase is waiting on a confirmation click before issuing a session. */
  needsConfirmation: boolean
}

export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<SignUpResult> {
  const { data, error } = await client().auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      // The API reads this out of the JWT to name the user on first request.
      data: { full_name: displayName.trim() },
      emailRedirectTo: window.location.origin,
    },
  })
  if (error) throw new Error(friendly(error.message))

  // Supabase deliberately returns a user with no identities, rather than an
  // error, when the address is already registered - so the sign-up form cannot
  // be used to discover who has an account. Treat it like any other pending
  // confirmation instead of leaking the difference.
  return { needsConfirmation: !data.session }
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: window.location.origin },
  )
  if (error) throw new Error(friendly(error.message))
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await client().auth.updateUser({ password })
  if (error) throw new Error(friendly(error.message))
}

export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await client().auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) throw new Error(friendly(error.message))
}

/** Supabase's messages are terse and occasionally alarming; soften the common ones. */
function friendly(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('invalid login credentials')) {
    return 'That email and password combination did not work.'
  }
  if (lower.includes('email not confirmed')) {
    return 'Confirm your email address first — check your inbox for the link.'
  }
  if (lower.includes('password should be')) {
    return 'That password is too short. Use at least 8 characters.'
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many attempts just now. Wait a minute and try again.'
  }
  return message
}
