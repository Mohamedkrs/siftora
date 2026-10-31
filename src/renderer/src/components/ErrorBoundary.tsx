import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    window.api.log('error', `render error: ${error.message}\n${info.componentStack ?? ''}`)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="error-panel">
        <h1>Something went wrong</h1>
        <p>The app hit an unexpected error. Reload to try again.</p>
        <pre>{error.message}</pre>
        <button className="button primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
