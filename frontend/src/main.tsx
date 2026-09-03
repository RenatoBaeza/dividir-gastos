import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'

import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { ConfirmProvider } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TooltipProvider } from './components/ui/tooltip'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <BrowserRouter>
          <TooltipProvider>
            <AuthProvider>
              <ConfirmProvider>
                <App />
              </ConfirmProvider>
            </AuthProvider>
          </TooltipProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
