import { History } from 'lucide-react'

import { PersonAvatar } from '@/components/PersonAvatar'
import { Card, CardContent } from '@/components/ui/card'
import { displayName, formatDateTime } from '@/lib/format'
import type { Activity } from '@/types'

export function ActivityTab({
  entries,
  currentUserId,
}: {
  entries: Activity[]
  currentUserId: string
}) {
  if (entries.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted">
            <History className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden py-0">
      <ul className="divide-y">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
            <PersonAvatar user={entry.actor} className="mt-0.5 size-7" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">
                  {entry.actor.id === currentUserId ? 'You' : displayName(entry.actor)}
                </span>{' '}
                {entry.summary}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(entry.created_at)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
