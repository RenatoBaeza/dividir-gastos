import { useCallback } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, RefreshCw } from 'lucide-react'

import { useAuth } from '@/auth/AuthProvider'
import { ErrorState } from '@/components/ErrorState'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { NetBadge } from '@/components/NetBadge'
import { PersonAvatar } from '@/components/PersonAvatar'
import { ActivityTab } from '@/components/group/ActivityTab'
import { BalancesTab } from '@/components/group/BalancesTab'
import { ExpensesTab } from '@/components/group/ExpensesTab'
import { SettingsTab } from '@/components/group/SettingsTab'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { displayName, pluralize } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useRevalidateOnFocus } from '@/lib/useRevalidate'

const TABS = ['expenses', 'balances', 'activity', 'settings'] as const
type Tab = (typeof TABS)[number]

/** Past this many faces the row stops reading as people and starts reading as
 *  a texture. */
const AVATARS_SHOWN = 6

export default function GroupPage() {
  const { groupId = '' } = useParams()
  const { user } = useAuth()

  // The tab lives in the URL, so a refresh keeps you where you were, Back goes
  // back a tab instead of leaving the group, and "look at the balances" is a
  // link somebody can actually send.
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') as Tab | null
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'expenses'

  const bundle = useAsync(async () => {
    const group = await api.getGroup(groupId)
    const [expenses, balances, settlements, activity] = await Promise.all([
      api.listExpenses(groupId),
      api.balances(groupId),
      api.listSettlements(groupId),
      api.activity(groupId),
    ])
    return { group, expenses, balances, settlements, activity }
  }, [groupId])

  const reload = useCallback(() => {
    void bundle.reload()
  }, [bundle])

  useRevalidateOnFocus(reload)
  useDocumentTitle(bundle.data?.group.name)

  if (bundle.loading) return <FullPageSpinner label="Loading group…" />

  if (bundle.error || !bundle.data || !user) {
    return (
      <div className="space-y-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          All groups
        </Link>
        <ErrorState
          title="Could not open this group"
          message={
            bundle.error ??
            'It may have been deleted, or you may no longer be a member of it.'
          }
          onRetry={reload}
          retrying={bundle.refreshing}
        />
      </div>
    )
  }

  const { group, expenses, balances, settlements, activity } = bundle.data
  const myNet = balances.balances.find((row) => row.user.id === user.id)?.net ?? '0'
  const extraMembers = group.members.length - AVATARS_SHOWN

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronLeft className="size-4" aria-hidden />
        All groups
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
            {/* A refresh over data already on screen should say so quietly,
                not blank the page out. */}
            {bundle.refreshing ? (
              <RefreshCw
                className="size-4 animate-spin text-muted-foreground"
                aria-label="Refreshing"
              />
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {group.description ? `${group.description} · ` : ''}base currency{' '}
            {group.base_currency}
          </p>
          <div className="mt-3 flex flex-wrap items-center">
            <div className="flex -space-x-2">
              {group.members.slice(0, AVATARS_SHOWN).map((member) => (
                <Tooltip key={member.user.id}>
                  <TooltipTrigger render={<span className="rounded-full" />}>
                    <PersonAvatar
                      user={member.user}
                      className="size-8 ring-2 ring-background"
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {displayName(member.user)}
                    {member.user.id === user.id ? ' (you)' : ''}
                  </TooltipContent>
                </Tooltip>
              ))}
              {extraMembers > 0 ? (
                <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-medium ring-2 ring-background">
                  +{extraMembers}
                </span>
              ) : null}
            </div>
            <span className="ml-3 text-xs text-muted-foreground">
              {pluralize(group.members.length, 'member')}
            </span>
          </div>
        </div>

        <Card className="min-w-48">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Your balance</p>
            <NetBadge amount={myNet} currency={group.base_currency} className="text-2xl" />
            <p className="mt-1 text-xs text-muted-foreground">
              {balances.simplified.length === 0
                ? 'Everyone is square'
                : `${pluralize(balances.simplified.length, 'payment')} to settle the group`}
            </p>
          </CardContent>
        </Card>
      </header>

      <Tabs
        value={tab}
        onValueChange={(next) => {
          // `replace` so the browser Back button leaves the group rather than
          // walking back through every tab the person happened to touch.
          setParams(
            next && next !== 'expenses' ? { tab: String(next) } : {},
            { replace: true },
          )
        }}
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="mt-4">
          <ExpensesTab
            group={group}
            expenses={expenses}
            currentUserId={user.id}
            onChanged={reload}
          />
        </TabsContent>

        <TabsContent value="balances" className="mt-4">
          <BalancesTab
            group={group}
            balances={balances}
            settlements={settlements}
            currentUserId={user.id}
            onChanged={reload}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTab entries={activity} currentUserId={user.id} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <SettingsTab group={group} currentUserId={user.id} onChanged={reload} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
