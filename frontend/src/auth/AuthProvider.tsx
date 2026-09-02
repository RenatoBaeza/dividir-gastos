import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { api } from '@/lib/api'
import { devEmail, supabase } from '@/lib/supabase'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
  /** True while the session came from a password-reset link. */
  passwordRecovery: boolean
  endPasswordRecovery: () => void
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  /** Ask the API who we are. This is also what creates the `app_users` row on
   *  a first-ever sign-in, so it runs before anything else is fetched. */
  const loadProfile = useCallback(async () => {
    try {
      setUser(await api.me())
      setError(null)
    } catch (err) {
      setUser(null)
      setError(err instanceof Error ? err.message : 'Could not reach the API')
    }
  }, [])

  useEffect(() => {
    let active = true

    async function boot() {
      if (devEmail) {
        await loadProfile()
        if (active) setLoading(false)
        return
      }

      if (!supabase) {
        if (active) {
          setError('Supabase is not configured. See frontend/.env.example.')
          setLoading(false)
        }
        return
      }

      const { data } = await supabase.auth.getSession()
      if (data.session) await loadProfile()
      if (active) setLoading(false)
    }

    void boot()

    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Arrives with a short-lived session that may only be used to set a new
        // password, so flag it instead of dropping into the app.
        setPasswordRecovery(true)
        void loadProfile()
        return
      }
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setPasswordRecovery(false)
        return
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void loadProfile()
      }
    })

    return () => {
      active = false
      subscription?.data.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut()
    setUser(null)
    setPasswordRecovery(false)
  }, [])

  const endPasswordRecovery = useCallback(() => setPasswordRecovery(false), [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      passwordRecovery,
      endPasswordRecovery,
      signOut,
      refreshUser: loadProfile,
    }),
    [user, loading, error, passwordRecovery, endPasswordRecovery, signOut, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider')
  return context
}
