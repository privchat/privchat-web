// Centralised error reporting funnel.
//
// Every error the app surfaces — from `<ErrorBoundary>`, from
// `window.error` / `unhandledrejection`, from explicit catches in
// async flows — should go through `captureException` so we have one
// place to swap in Sentry / Datadog / a custom HTTP sink later.
//
// The default reporter is a `console.error` shim. A real reporter
// installs itself via `setReporter(...)` at app boot — keeps the
// vendor SDK out of the main bundle until a deploy actually wants
// it. Initial integration TODO is described in `setReporter`'s
// doc comment.
//
// Why not import Sentry directly?
//   - bundle weight: @sentry/browser is ~50KB minified; not paying
//     it until ops actually wires up a DSN.
//   - principle: app code should not know about its observability
//     vendor. Tomorrow we may swap to OpenTelemetry / Honeycomb;
//     `setReporter` is the seam.
//
// R7.1 — every captured event is auto-tagged with the current
// active account (`accountKey`) so future multi-account dogfood
// can attribute errors per-account. Today there's only ever one
// account so the tag is effectively constant; R7.3 makes it
// useful.

import { getActiveAccountKey } from './active-account';

export interface ErrorContext {
  /** A short label for where the error came from. Examples:
   *  "react-boundary", "window.error", "outbox-retry", "media-upload". */
  source?: string;
  /** Free-form structured fields. Should NOT contain PII /
   *  message bodies — at most ids, route names, status codes. */
  extra?: Record<string, unknown>;
  /** R7.1 — which account this error happened under. Auto-filled
   *  by `captureException` / `captureMessage` from the active-
   *  account seam if the caller doesn't supply one. Useful in
   *  multi-account dogfood / production for triaging "is this
   *  account A's bug or account B's?". */
  accountKey?: string;
}

export interface Reporter {
  captureException(err: unknown, ctx?: ErrorContext): void;
  captureMessage(message: string, ctx?: ErrorContext): void;
}

let current: Reporter = {
  captureException(err, ctx) {
    // eslint-disable-next-line no-console
    console.error(
      '[reporter]',
      ctx?.source ?? 'unknown',
      ctx?.accountKey !== undefined ? `acct=${ctx.accountKey}` : '',
      err,
      ctx?.extra,
    );
  },
  captureMessage(message, ctx) {
    // eslint-disable-next-line no-console
    console.warn(
      '[reporter]',
      ctx?.source ?? 'unknown',
      ctx?.accountKey !== undefined ? `acct=${ctx.accountKey}` : '',
      message,
      ctx?.extra,
    );
  },
};

/**
 * Replace the active reporter. Call once at app boot when ops wants
 * to enable Sentry / similar:
 *
 * ```ts
 * import * as Sentry from '@sentry/browser';
 * Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN });
 * setReporter({
 *   captureException: (err, ctx) =>
 *     Sentry.captureException(err, { tags: { source: ctx?.source }, extra: ctx?.extra }),
 *   captureMessage: (msg, ctx) =>
 *     Sentry.captureMessage(msg, { tags: { source: ctx?.source }, extra: ctx?.extra }),
 * });
 * ```
 *
 * Until then the default `console.error` reporter is fine for dev.
 */
export function setReporter(next: Reporter): void {
  current = next;
}

export function captureException(err: unknown, ctx?: ErrorContext): void {
  current.captureException(err, withAccountTag(ctx));
}

export function captureMessage(message: string, ctx?: ErrorContext): void {
  current.captureMessage(message, withAccountTag(ctx));
}

/** Auto-tag an `ErrorContext` with the current active account
 *  unless the caller already specified one. */
function withAccountTag(ctx: ErrorContext | undefined): ErrorContext {
  if (ctx?.accountKey !== undefined) return ctx;
  return { ...ctx, accountKey: getActiveAccountKey() };
}

/** Wire `window.error` + `window.unhandledrejection` into the reporter
 *  funnel. Idempotent — safe to call from `main.tsx` once at boot. */
export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (event) => {
    captureException(event.error ?? event.message, {
      source: 'window.error',
      extra: {
        filename: event.filename,
        line: event.lineno,
        col: event.colno,
      },
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    captureException(event.reason, {
      source: 'window.unhandledrejection',
    });
  });
}
