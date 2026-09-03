import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/**
 * Bouncing a bad URL silently to the dashboard leaves the person thinking the
 * link worked and the group vanished. Say what happened instead.
 */
export default function NotFoundPage() {
  useDocumentTitle('Page not found')

  return (
    <EmptyState
      icon={Compass}
      title="There is nothing at this address"
      description="The link may be out of date, or the group it pointed at may have been deleted."
      action={
        <Button render={<Link to="/" />}>Back to your groups</Button>
      }
    />
  )
}
