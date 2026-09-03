import { useEffect } from 'react'

const SUFFIX = 'Dividir Gastos'

/**
 * The tab title is the only label a person has for a background tab, and the
 * text the browser stores in history and bookmarks.
 */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX
    return () => {
      document.title = SUFFIX
    }
  }, [title])
}
