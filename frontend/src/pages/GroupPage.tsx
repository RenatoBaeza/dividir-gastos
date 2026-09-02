import { useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

import { useAuth } from '@/auth/AuthProvider'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { NetBadge } from '@/components/NetBadge'
import { PersonAvatar } from '@/components/PersonAvatar'
import { ActivityTab } from '@/components/group/ActivityTab'
import { BalancesTab } from '@/components/group/BalancesTab'
import { ExpensesTab } from '@/components/group/ExpensesTab'
import { SettingsTab } from '@/components/group/SettingsTab'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/useAsync'

export default function GroupPage() {
  const { groupId = '' } = useParams()
  const { user } = useAuth()

  const bundle = useAsync(
    async () => {
      const group = await api.getGroup(groupId)
      const [expenses, balances, settlements, activity] = await Promise.all([
        api.listExpenses(groupId),
        api.balances(groupId),
        api.listSettlements(groupId),
        api.activity(groupId),
      ])
      return { group, expenses, balances, settlements, activity }
    },
    [groupId],
  )

  const reload = useCallback(() => {
    void bundle.reload()
  }, [bundle])

  if (bundle.loading && !bundle.data) return <FullPageSpinner label="Loading group…" />

  if (bundle.error || !bundle.data || !user) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-8 text-sm text-destructive">
          {bundle.error ?? 'Group not found'}
        </CardContent>
      </Card>
    )
  }

  const { group, expenses, balances, settlements, activity } = bundle.data
  const myNet = balances.balances.find((row) => row.user.id === user.id)?.net ?? '0'

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        All groups
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
          <p className="text-sm text-muted-foreground">
            {group.description || 'No description'} · base currency{' '}
            {group.base_currency}
          </p>
          <div className="mt-3 flex -space-x-2">
            {group.members.map((member) => (
              <PersonAvatar
                key={member.user.id}
                user={member.user}
                className="size-8 ring-2 ring-background"
              />
            ))}
          </div>
        </div>

        <Card className="min-w-48">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Your balance</p>
            <NetBadge
              amount={myNet}
              currency={group.base_currency}
              className="text-2xl"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {balances.simplified.length} payment
              {balances.simplified.length === 1 ? '' : 's'} to settle the group
            </p>
          </CardContent>
        </Card>
      </header>

      <Tabs defaultValue="expenses">
        <TabsList>
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
