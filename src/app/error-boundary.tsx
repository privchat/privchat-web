// Top-level React error boundary. Catches render-phase errors so a
// thrown component doesn't blank-screen the whole app. Errors are
// funnelled into `captureException` so the same observability sink
// sees boundary crashes alongside async failures.
//
// Scope intentionally narrow: ONE boundary at the very top of the
// tree. Per-feature boundaries can be added later if specific
// surfaces (e.g. media viewer, group info dialog) want to recover
// without nuking the whole app, but for v1 a single boundary +
// "reload" recovery is enough — and it dominates the user value
// vs effort tradeoff.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureException } from '@/lib/error-reporter';

interface Props {
  children: ReactNode;
  /** Optional override for the fallback UI. Default: a generic
   *  "Something went wrong · Reload" panel translated through the
   *  app's i18n bundle. We keep the default minimal because the i18n
   *  consumer is a hook and class components can't use hooks — the
   *  fallback receives the raw error and the reload handler. */
  fallback?: (args: { error: unknown; reload: () => void }) => ReactNode;
}

interface State {
  error: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    captureException(error, {
      source: 'react-boundary',
      extra: { componentStack: info.componentStack ?? undefined },
    });
  }

  private readonly reload = () => {
    // Hard reload — we don't try to clear local state because we
    // don't know which slice was poisoned. A clean boot from the
    // persisted session is the simplest recovery.
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback({
          error: this.state.error,
          reload: this.reload,
        });
      }
      return <DefaultFallback error={this.state.error} reload={this.reload} />;
    }
    return this.props.children;
  }
}

/** Tailwind-styled but i18n-free default fallback. We avoid the
 *  i18n hook here because if the boundary fires before i18n is
 *  initialised (rare but possible during HMR / startup) the fallback
 *  itself shouldn't crash. English-only is acceptable for a panic
 *  screen the average user should never see. */
function DefaultFallback({
  error,
  reload,
}: {
  error: unknown;
  reload: () => void;
}) {
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown error');
  return (
    <div className="flex h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-3 rounded-lg border bg-card p-6 text-center shadow-sm">
        <div className="text-base font-semibold text-foreground">
          Something went wrong
        </div>
        <p className="text-xs text-muted-foreground break-words">{message}</p>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
