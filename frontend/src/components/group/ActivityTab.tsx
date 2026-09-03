import { useMemo, useState } from 'react'
import { History } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { PersonAvatar } from '@/components/PersonAvatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { displayName, formatDateTime, formatDateTimeFull } from '@/lib/format'
import type { Activity } from '@/types'

const PAGE = 40

export function ActivityTab({
  entries,
  currentUserId,
}: {
  entries: Activity[]
  currentUserId: string
}) {
  const [limit, setLimit] = useState(PAGE)
  const visible = useMemo(() => entries.slice(0, limit), [entries, limit])

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Nothing has happened yet"
        description="Every expense, edit and repayment anyone records in this group shows up here."
      />
    )
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden py-0">
        <ul className="divide-y">
          {visible.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
              <PersonAvatar user={entry.actor} className="mt-0.5 size-7" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">
                    {entry.actor.id === currentUserId ? 'You' : displayName(entry.actor)}
                  </span>{' '}
                  {entry.summary}
                </p>
                {/* Relative reads faster; the exact stamp is one hover away for
                    the times somebody is reconstructing what happened when. */}
                <time
                  dateTime={entry.created_at}
                  title={formatDateTimeFull(entry.created_at)}
                  className="text-xs text-muted-foreground"
                >
                  {formatDateTime(entry.created_at)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {entries.length > limit ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setLimit((current) => current + PAGE)}
        >
          Show older activity
        </Button>
      ) : null}
    </div>
  )
}
