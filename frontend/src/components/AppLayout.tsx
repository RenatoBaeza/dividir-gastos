import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogOut, Scale, Settings, User as UserIcon, Wallet } from 'lucide-react'

import { useAuth } from '@/auth/AuthProvider'
import { AccountDialog } from '@/components/AccountDialog'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { OfflineBanner } from '@/components/OfflineBanner'
import { PersonAvatar } from '@/components/PersonAvatar'
import { SkipToContent } from '@/components/RouteChrome'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayName } from '@/lib/format'
import { devEmail } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Groups', icon: Scale, end: true },
  { to: '/personal', label: 'Personal', icon: Wallet, end: false },
]

export function AppLayout() {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const [accountOpen, setAccountOpen] = useState(false)

  return (
    <div className="min-h-screen bg-muted/30">
      <SkipToContent />
      <OfflineBanner />

      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:gap-6 sm:px-4">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Scale className="size-4" aria-hidden />
            </span>
            {/* The wordmark is the first thing to go when space runs out — the
                mark alone still identifies the app and still goes home. */}
            <span className="hidden sm:inline">Dividir Gastos</span>
          </Link>

          <nav aria-label="Main" className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => {
              const isGroupDetail = to === '/' && location.pathname.startsWith('/groups')
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:px-3',
                      (isActive || isGroupDetail) && 'bg-muted font-medium text-foreground',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </NavLink>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {devEmail ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="hidden rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground sm:inline" />
                  }
                >
                  dev auth
                </TooltipTrigger>
                <TooltipContent>
                  Signed in as {devEmail} without a password, from
                  VITE_AUTH_DEV_EMAIL.
                </TooltipContent>
              </Tooltip>
            ) : null}

            <ThemeToggle />

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      className="h-9 gap-2 px-1.5 sm:px-2"
                      aria-label={`Account menu for ${displayName(user)}`}
                    />
                  }
                >
                  <PersonAvatar user={user} className="size-7" />
                  <span className="hidden max-w-32 truncate text-sm sm:inline">
                    {displayName(user)}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <p className="truncate text-sm font-medium">{displayName(user)}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link to="/personal" />}>
                    <UserIcon className="size-4" aria-hidden />
                    Personal expenses
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAccountOpen(true)}>
                    <Settings className="size-4" aria-hidden />
                    Account
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void signOut()}>
                    <LogOut className="size-4" aria-hidden />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 py-6 outline-none sm:py-8"
      >
        <Suspense fallback={<FullPageSpinner />}>
          <Outlet />
        </Suspense>
      </main>

      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  )
}
