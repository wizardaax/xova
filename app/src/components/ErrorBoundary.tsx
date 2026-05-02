import { Component, type ReactNode } from "react";

/**
 * Top-level error boundary. Without it, any render-time error in any
 * component white-screens the entire app — chat, panels, palette all gone.
 *
 * With it, the rest of the UI keeps working and the failed subtree is
 * replaced by an inline error block. The user can copy the message + stack
 * straight into the chat to ask for a fix without opening devtools.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback. Defaults to a minimal inline error block. */
  fallback?: (error: Error, info: { componentStack?: string | null }) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: { componentStack?: string | null } | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.setState({ error, info });
    // Surface to the activity panel via the same custom-event channel
    // useVoiceXova / CommandBar use, so the failure lands somewhere
    // visible-to-user instead of only in devtools.
    try {
      window.dispatchEvent(new CustomEvent("xova-activity", {
        detail: `render error: ${error.message}`,
      }));
    } catch { /* never let the boundary itself throw */ }
  }

  reset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.state.info ?? {});
      }
      return (
        <div className="m-4 rounded border border-rose-800 bg-rose-950/40 p-4 font-mono text-xs text-rose-300">
          <div className="mb-2 text-sm font-semibold text-rose-200">render error</div>
          <div className="mb-2 whitespace-pre-wrap break-words">{this.state.error.message}</div>
          {this.state.info?.componentStack && (
            <details className="mt-2 text-rose-400/80">
              <summary className="cursor-pointer text-rose-300">component stack</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words text-[10px]">{this.state.info.componentStack}</pre>
            </details>
          )}
          <button
            onClick={this.reset}
            className="mt-3 rounded border border-rose-700 bg-rose-900/40 px-2 py-1 text-rose-200 hover:bg-rose-800/40"
          >retry render</button>
        </div>
      );
    }
    return this.props.children;
  }
}
