import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Card, CardContent } from '@/components/ui/card'

/**
 * An empty state is the first screen most people see. It has to say what this
 * is, why it is empty, and — the part usually missing — offer the action that
 * fills it, right here, so nobody has to go hunting for the button.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <Card className="border-dashed">
      <CardContent
        className={
          compact
            ? 'flex flex-col items-center gap-3 py-10 text-center'
            : 'flex flex-col items-center gap-3 py-14 text-center'
        }
      >
        <span className="grid size-12 place-items-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" aria-hidden />
        </span>
        <div className="max-w-sm">
          <p className="font-medium">{title}</p>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
      </CardContent>
    </Card>
  )
}
