import { WifiOff } from 'lucide-react'

import { useOnline } from '@/lib/useOnline'

/**
 * Without this, losing the network looks exactly like the app being broken:
 * every action fails with a different message and nothing says why.
 */
export function OfflineBanner() {
  const online = useOnline()
  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950"
    >
      <WifiOff className="size-3.5" aria-hidden />
      You are offline. Anything you change will not be saved until you reconnect.
    </div>
  )
}
