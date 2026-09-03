import { RefreshCw, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Every failure the person can retry has to offer the retry. A dead-end error
 * message forces a full page reload, which loses whatever they were doing.
 */
export function ErrorState({
  title = 'That did not load',
  message,
  onRetry,
  retrying = false,
}: {
  title?: string
  message: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-start gap-3 py-6 sm:flex-row sm:items-center">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlert className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1" role="alert">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        {onRetry ? (
          <Button variant="outline" onClick={onRetry} disabled={retrying}>
            <RefreshCw
              className={retrying ? 'size-4 animate-spin' : 'size-4'}
              aria-hidden
            />
            Try again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
