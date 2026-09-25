import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Compact inline fallback (for a single screen) instead of full-page. */
  inline?: boolean;
}

interface State {
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.inline ? 'p-6' : 'flex min-h-full items-center justify-center p-6 pt-safe'}>
        <div className="w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-card">
          <div className="text-5xl" aria-hidden>
            🧯
          </div>
          <h1 className="mt-3 text-[20px] font-bold">Something broke</h1>
          <p className="mt-1 text-[14px] text-muted">Your data is safe on this device. Try again — if it keeps happening, export a backup from Settings.</p>
          <pre className="mt-3 max-h-24 overflow-auto rounded-xl bg-surface-2 p-2 text-left text-[11px] text-muted">{this.state.error.message}</pre>
          <div className="mt-4 flex gap-2">
            <button type="button" className="h-11 flex-1 rounded-2xl bg-surface-2 font-semibold" onClick={() => this.setState({ error: undefined })}>
              Try again
            </button>
            <button type="button" className="h-11 flex-1 rounded-2xl bg-accent font-semibold text-on-accent" onClick={() => window.location.assign('/')}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
