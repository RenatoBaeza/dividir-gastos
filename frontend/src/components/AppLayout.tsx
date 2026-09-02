import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogOut, Scale, Settings, User as UserIcon, Wallet } from 'lucide-react'

import { useAuth } from '@/auth/AuthProvider'
import { AccountDialog } from '@/components/AccountDialog'
import { PersonAvatar } from '@/components/PersonAvatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Scale className="size-4" aria-hidden />
            </span>
            Dividir Gastos
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
                    (isActive || (to === '/' && location.pathname.startsWith('/groups'))) &&
                      'bg-muted font-medium text-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {devEmail ? (
              <span className="rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
                dev auth
              </span>
            ) : null}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" className="h-9 gap-2 px-2" />}
                >
                  <PersonAvatar user={user} className="size-7" />
                  <span className="hidden text-sm sm:inline">{displayName(user)}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <p className="text-sm font-medium">{displayName(user)}</p>
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

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>

      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  )
}
