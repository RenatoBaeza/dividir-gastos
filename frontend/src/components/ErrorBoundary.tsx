import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface State {
  error: Error | null
}

/**
 * Without this, one bad render unmounts the whole tree and the person is left
 * looking at a white page with no way forward and no idea what happened.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Something broke on this screen</CardTitle>
            <CardDescription>
              Your data is safe — nothing was saved or lost. Reloading usually
              clears it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
            <div className="flex gap-2">
              <Button onClick={() => window.location.reload()}>
                <RefreshCw className="size-4" aria-hidden />
                Reload
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  this.setState({ error: null })
                  window.location.assign('/')
                }}
              >
                Back to your groups
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
}
