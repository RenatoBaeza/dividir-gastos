import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * A single-page app keeps the scroll position and the focus ring where they
 * were on the previous screen, which is wrong twice over: sighted people land
 * halfway down a page they have not read, and anyone on a keyboard or a screen
 * reader is left focused on a link that no longer exists.
 */
export function RouteChrome() {
  const { pathname } = useLocation()
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })

    // Move focus to the top of the new content without stealing it from a
    // field the person deliberately focused during the transition.
    const main = document.getElementById('main-content')
    if (main && document.activeElement === document.body) {
      main.focus({ preventScroll: true })
    }
  }, [pathname])

  return null
}

/** The first thing in the tab order: a way past the header for people who do
 *  not use a mouse. Visible only once it has focus. */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
    >
      Skip to content
    </a>
  )
}
