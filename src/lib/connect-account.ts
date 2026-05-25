// R7.3 — single helper that takes a `PersistedSession`, runs the
// R7.2b legacy → account-DB copy, builds a fresh `PrivchatHandle`
// bound to the right Dexie name, connects + authenticates, and
// returns it.
//
// Used by every code path that turns a saved session into a live
// client:
//
//   - App boot auto-login (after R7.2a session migration produces
//     an active account)
//   - Fresh login (`onLoggedIn`) — replaces the R7.2b leftover
//     where login-page's temp client was bound to LEGACY_DB_NAME
//   - Add-account flow (same shape as fresh login, just with a
//     prior handle to dispose first)
//   - R7.4 switcher (will reuse this helper on every account flip)
//
// The helper does NOT manage React state. Callers handle dispose
// of any previous handle and call `setHandle(next)` themselves.
// Errors are propagated; callers decide whether to clearSession,
// retry, or fall back to the login page.

import { accountKeyFor, type AccountKey } from './account-key';
import { resolveDbNameForActiveAccount } from './migrate-legacy-db';
import { createPrivchat, type PrivchatHandle } from './privchat-client';
import type { PersistedSession } from './session-storage';
import { captureException } from './error-reporter';
import { buildAuthRefresh } from './auth-refresh-provider';

export interface ConnectAccountResult {
  handle: PrivchatHandle;
  accountKey: AccountKey;
  dbName: string;
}

/** Connect + authenticate the SDK against `session`'s gateway,
 *  bound to the per-account Dexie DB. Throws on connect / RPC /
 *  authenticate failure (caller decides recovery). */
export async function connectAccount(
  session: PersistedSession,
): Promise<ConnectAccountResult> {
  const accountKey = await accountKeyFor(session.url, session.user_id);
  const dbName = await resolveDbNameForActiveAccount(accountKey, (err) => {
    captureException(err, { source: 'connect-account.db-migration' });
  });
  const handle = createPrivchat({ url: session.url, dbName });
  // Install SDK-owned auth refresh BEFORE authenticate, so an expired
  // access token (here on cold-start auth, or later on auto-reconnect
  // replay) is transparently refreshed + retried instead of bouncing the
  // user to login. Terminal failure surfaces via the `session_expired`
  // event (App shows the re-login dialog).
  handle.client.configureAuthRefresh(buildAuthRefresh());
  try {
    await handle.client.connect();
    await handle.client.authenticate(
      session.user_id,
      session.access_token,
      session.device_id,
    );
  } catch (err) {
    // Ensure the half-built websocket / Dexie handle don't leak
    // when authenticate fails (stale token, server unreachable,
    // etc). Caller still gets the original error to surface or
    // recover from.
    await handle.client.dispose().catch(() => {});
    throw err;
  }
  return { handle, accountKey, dbName };
}
