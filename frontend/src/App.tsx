import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'

import { useAuth } from '@/auth/AuthProvider'
import { AppLayout } from '@/components/AppLayout'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import DashboardPage from '@/pages/DashboardPage'
import GroupPage from '@/pages/GroupPage'
import LoginPage from '@/pages/LoginPage'
import PersonalPage from '@/pages/PersonalPage'
import UpdatePasswordPage from '@/pages/UpdatePasswordPage'

export default function App() {
  const { user, loading, passwordRecovery } = useAuth()

  if (loading) return <FullPageSpinner />

  // A reset link signs the person in, so this has to pre-empt the router or
  // they would land in the app without ever setting the new password.
  if (passwordRecovery) {
    return (
      <>
        <UpdatePasswordPage />
        <Toaster position="bottom-right" richColors />
      </>
    )
  }

  return (
    <>
      <Routes>
        {user ? (
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/personal" element={<PersonalPage />} />
            <Route path="/groups/:groupId" element={<GroupPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        ) : (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        )}
      </Routes>
      <Toaster position="bottom-right" richColors />
    </>
  )
}
