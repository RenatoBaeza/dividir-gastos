import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'

import { useAuth } from '@/auth/AuthProvider'
import { AppLayout } from '@/components/AppLayout'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { RouteChrome } from '@/components/RouteChrome'

// Split per screen. Signing in should not first download the Splitwise
// importer, and the importer's preview table is the heaviest thing here.
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const GroupPage = lazy(() => import('@/pages/GroupPage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const PersonalPage = lazy(() => import('@/pages/PersonalPage'))
const UpdatePasswordPage = lazy(() => import('@/pages/UpdatePasswordPage'))

const RETURN_TO = 'returnTo'

/**
 * Someone opening a link to a specific group while signed out should land on
 * that group after signing in, not on a dashboard that makes them find it
 * again. The session survives the full remount that signing in causes.
 */
function RequireLogin() {
  const location = useLocation()

  useEffect(() => {
    const target = location.pathname + location.search
    if (target !== '/' && target !== '/login') {
      try {
        sessionStorage.setItem(RETURN_TO, target)
      } catch {
        // Private mode. They land on the dashboard, which is survivable.
      }
    }
  }, [location])

  return <Navigate to="/login" replace />
}

function ResumeAfterLogin() {
  const navigate = useNavigate()

  useEffect(() => {
    let target: string | null = null
    try {
      target = sessionStorage.getItem(RETURN_TO)
      sessionStorage.removeItem(RETURN_TO)
    } catch {
      return
    }
    if (target && target !== window.location.pathname) navigate(target, { replace: true })
  }, [navigate])

  return null
}

export default function App() {
  const { user, loading, passwordRecovery } = useAuth()

  if (loading) return <FullPageSpinner full label="Getting your groups ready…" />

  // A reset link signs the person in, so this has to pre-empt the router or
  // they would land in the app without ever setting the new password.
  if (passwordRecovery) {
    return (
      <>
        <Suspense fallback={<FullPageSpinner full />}>
          <UpdatePasswordPage />
        </Suspense>
        <Toaster position="bottom-right" richColors closeButton />
      </>
    )
  }

  return (
    <>
      <RouteChrome />
      {/* The layout itself is eager, and holds its own boundary around the
          page, so navigating never tears the header off the screen. */}
      <Suspense fallback={<FullPageSpinner full />}>
        <Routes>
          {user ? (
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/personal" element={<PersonalPage />} />
              <Route path="/groups/:groupId" element={<GroupPage />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          ) : (
            <>
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<RequireLogin />} />
            </>
          )}
        </Routes>
      </Suspense>
      {user ? <ResumeAfterLogin /> : null}
      {/* Toasts are announced politely and stay long enough to read; an Undo
          that vanishes in two seconds is not an Undo. */}
      <Toaster position="bottom-right" richColors closeButton duration={5000} />
    </>
  )
}
