import { useEffect, useRef } from 'react'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  )
}

/**
 * A single-key shortcut, ignored while the person is typing or a dialog owns
 * the screen. Shortcuts that fire inside a text field are worse than no
 * shortcuts at all.
 */
export function useHotkey(key: string, handler: () => void, enabled = true) {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== key) return
      if (isTyping(event.target)) return
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return
      event.preventDefault()
      handlerRef.current()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, enabled])
}

/** Ctrl/Cmd+Enter submits the form the event started in — the convention for
 *  "I am done with this dialog" without reaching for the mouse. */
export function submitOnMetaEnter(event: React.KeyboardEvent) {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
  const form = (event.target as HTMLElement).closest('form')
  if (form) form.requestSubmit()
}
