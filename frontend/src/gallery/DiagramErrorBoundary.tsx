import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export class DiagramErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Failed to display gallery diagram.', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-center px-5 py-10">
        <div className="rounded-xl border border-border bg-surface px-6 py-6">
          <h1 className="text-xl font-semibold text-foreground">
            Something went wrong displaying this diagram.
          </h1>
          <div className="mt-4 flex items-center gap-4 text-sm font-medium">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-accent hover:underline"
            >
              Reload
            </button>
            <Link to="/gallery" className="text-accent hover:underline">
              Back to gallery
            </Link>
          </div>
        </div>
      </div>
    );
  }
}
