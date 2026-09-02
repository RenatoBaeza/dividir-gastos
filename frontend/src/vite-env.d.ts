/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Local-only: bypass sign-in entirely and authenticate as this email. */
  readonly VITE_AUTH_DEV_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
