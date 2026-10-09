import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  failed: boolean;
}

/**
 * If a screen hits a bug, show a friendly way out instead of a blank page.
 * Your seat is kept: reloading rejoins the room.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Screen failed", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen center-screen">
        <section className="card center-block" role="alert">
          <h1 className="card-title">Something went wrong on this screen</h1>
          <p className="card-lead">Your seat is safe. Reloading the page puts you back in your room.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => this.setState({ failed: false })}>
            Try without reloading
          </button>
        </section>
      </div>
    );
  }
}
