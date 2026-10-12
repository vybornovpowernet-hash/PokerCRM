import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.error === null) return this.props.children

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 px-6 text-center">
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-8 shadow-lg shadow-black/40">
          <h2 className="text-lg font-semibold text-slate-200">Что-то пошло не так</h2>
          <p className="mt-2 max-w-md text-sm text-slate-400">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700"
          >
            Перезагрузить страницу
          </button>
        </div>
      </div>
    )
  }
}
