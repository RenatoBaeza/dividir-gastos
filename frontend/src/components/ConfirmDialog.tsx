import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface ConfirmOptions {
  title: string
  /** What will actually happen, in the person's terms. Never "Are you sure?". */
  description?: ReactNode
  /** A verb, not "OK" — the button should read as the action it performs. */
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /**
   * For the handful of actions nothing can undo, ask the person to type the
   * name of the thing. It costs three seconds and it stops the misclick that
   * deletes a year of a group's history.
   */
  confirmText?: string
}

type Resolver = (confirmed: boolean) => void

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(
  null,
)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [typed, setTyped] = useState('')
  const resolver = useRef<Resolver | null>(null)

  const confirm = useCallback((next: ConfirmOptions) => {
    setTyped('')
    setOptions(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  function settle(confirmed: boolean) {
    resolver.current?.(confirmed)
    resolver.current = null
    setOptions(null)
  }

  const needsText = Boolean(options?.confirmText)
  const textMatches =
    !needsText || typed.trim().toLowerCase() === options?.confirmText?.trim().toLowerCase()

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={options !== null}
        onOpenChange={(open) => {
          // Escape, the backdrop and the close button all mean "no".
          if (!open) settle(false)
        }}
      >
        {options ? (
          <AlertDialogContent
            className="sm:max-w-md"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && textMatches) {
                event.preventDefault()
                settle(true)
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{options.title}</AlertDialogTitle>
              {options.description ? (
                <AlertDialogDescription>{options.description}</AlertDialogDescription>
              ) : null}
            </AlertDialogHeader>

            {needsText ? (
              <div className="grid gap-2">
                <Label htmlFor="confirm-text">
                  Type <span className="font-semibold">{options.confirmText}</span> to
                  confirm
                </Label>
                <Input
                  id="confirm-text"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                  autoFocus
                />
              </div>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => settle(false)}>
                {options.cancelLabel ?? 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                variant={options.destructive ? 'destructive' : 'default'}
                disabled={!textMatches}
                autoFocus={!needsText}
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? 'Confirm'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

/**
 * `window.confirm` blocks the whole tab, cannot be styled or translated, is
 * suppressed outright by some in-app browsers, and gives no room to say what
 * the consequence is. This replaces every use of it.
 */
export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside a ConfirmProvider')
  return confirm
}
