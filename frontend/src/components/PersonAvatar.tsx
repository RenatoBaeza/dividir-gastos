import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { displayName, initials } from '@/lib/format'
import type { User } from '@/types'

export function PersonAvatar({
  user,
  className,
}: {
  user: Pick<User, 'display_name' | 'email' | 'avatar_url'>
  className?: string
}) {
  return (
    <Avatar className={cn('size-8', className)}>
      {user.avatar_url ? (
        <AvatarImage src={user.avatar_url} alt={displayName(user)} />
      ) : null}
      <AvatarFallback className="text-xs font-medium">
        {initials(user.display_name, user.email)}
      </AvatarFallback>
    </Avatar>
  )
}
