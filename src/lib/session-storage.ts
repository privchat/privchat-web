// localStorage-backed session for auto-login.
//
// R7.2a: this module became a thin facade over the namespaced
// account-session storage and the registry. The legacy single-key
// `privchat.web.session` is now a migration source only — read /
// written by `migrate-single-account-session.ts` exactly once on
// boot, then deleted. After migration, every read / write goes
// through `(loadRegistry, loadAccountSession, saveAccountSession,
// upsertEntry)` keyed by the active `AccountKey`.
//
// Token is still plaintext in localStorage (sufficient for
// dev/dogfood, NOT a final auth model). Future hardening path:
// use refresh tokens (server already issues them) and only
// persist the refresh token; access token lives in memory.

import {
  accountKeyFor,
  LEGACY_DEFAULT_ACCOUNT_KEY,
  type AccountKey,
} from './account-key';
import type { AccountMode } from './account-mode';
import { setActiveAccountKey } from './active-account';
import {
  clearAccountSession,
  loadAccountSession,
  saveAccountSession,
} from './account-session';
import {
  loadRegistry,
  removeEntry,
  saveRegistry,
  upsertEntry,
  withActive,
} from './account-registry-store';

export interface PersistedSession {
  url: string;
  user_id: string;
  access_token: string;
  device_id: string;
  /** Wall-clock ms when this session was saved. Used to detect stale entries. */
  saved_at: number;
  /** R8.1 — which account system minted this session blob.
   *  Reads default to `'builtin'` when missing (see
   *  `sessionAccountMode()`). The `restoreSession` path uses
   *  this to pick the right `AccountAuthProvider` so a session
   *  saved under platform mode doesn't get re-authed against
   *  the builtin RPC on the next boot (and vice versa). */
  account_mode?: AccountMode;
  /** R8.1 — only present when `account_mode === 'platform'`. The
   *  platform host the access token was minted by; bound to the
   *  session so `refreshToken` knows which HTTP endpoint to hit. */
  platform_base_url?: string;
  /** R8.1 — refresh token issued by `privchat-platform`'s auth
   *  endpoints under PLATFORM mode. BUILTIN mode doesn't issue a
   *  separate refresh token today; the field stays optional so a
   *  future BUILTIN refresh feature wouldn't need a schema bump. */
  refresh_token?: string;
}

/** R8.1 reader rule: missing `account_mode` field counts as
 *  `'builtin'`. Same shape as `entryAccountMode` for the registry. */
export function sessionAccountMode(session: PersistedSession): AccountMode {
  return session.account_mode ?? 'builtin';
}

/** Resolve the active account's persisted session. Returns null
 *  when there's no active account (clean install / post-logout)
 *  or when the active account's session blob is missing /
 *  malformed.
 *
 *  Callers should run `migrateLegacySessionToRegistryOfOne()`
 *  before this on app boot — without that, a legacy install still
 *  has its session under the old key and `loadSession()` returns
 *  null. The migration runner publishes the active accountKey to
 *  the active-account seam, so subsequent reads here resolve. */
export function loadSession(): PersistedSession | null {
  const reg = loadRegistry();
  if (reg === null || reg.active === null) return null;
  return loadAccountSession(reg.active);
}

/** Persist credentials for the just-logged-in account. Async
 *  because deriving the AccountKey calls SubtleCrypto.digest.
 *  Idempotent for the same `(url, user_id)` — re-saving the same
 *  account just refreshes its token + bumps `saved_at`.
 *
 *  R7.4 split: this convenience wrapper does both
 *  `persistSessionForAccount` AND `commitActiveAccount`. The
 *  R7.4 sequencer needs the two halves separated (persist before
 *  trying to connect; only commit active after connect+auth
 *  succeeds), so it calls the lower-level helpers directly. New
 *  call sites should prefer the explicit pair. */
export async function saveSession(
  session: Omit<PersistedSession, 'saved_at'>,
): Promise<AccountKey> {
  const accountKey = await persistSessionForAccount(session);
  commitActiveAccount(accountKey);
  return accountKey;
}

/** R7.4 — write the namespaced session blob + ensure the registry
 *  has an entry for this account, but do NOT flip `registry.active`
 *  or the active-account seam. Returns the derived `AccountKey`.
 *
 *  Used by the switch sequencer's prepare phase: after a fresh
 *  login or add-account RPC succeeds, we persist the credentials
 *  immediately (so a connect failure doesn't lose them) but only
 *  commit-active once the new client connects + authenticates. */
export async function persistSessionForAccount(
  session: Omit<PersistedSession, 'saved_at'>,
): Promise<AccountKey> {
  const accountKey = await accountKeyFor(session.url, session.user_id);
  saveAccountSession(accountKey, session);
  const baseReg = loadRegistry() ?? { accounts: {}, active: null };
  const withEntry = upsertEntry(baseReg, accountKey, {
    url: session.url,
    user_id: session.user_id,
    device_id: session.device_id,
    // If the entry already exists, preserve its `added_at`;
    // otherwise stamp now.
    added_at: baseReg.accounts[accountKey]?.added_at ?? Date.now(),
    // R8.3b: PLATFORM accounts MUST carry mode + base URL on the
    // registry entry so auto-login can pick the right provider
    // without re-reading env (and so different accounts could in
    // theory come from different platform deployments).
    ...(session.account_mode !== undefined
      ? { mode: session.account_mode }
      : {}),
    ...(typeof session.platform_base_url === 'string' &&
    session.platform_base_url !== ''
      ? { platform_base_url: session.platform_base_url }
      : {}),
  });
  // Preserve whatever `active` was before (don't change it here).
  saveRegistry({ ...withEntry, active: baseReg.active });
  return accountKey;
}

/** R7.4 — commit `accountKey` as the active account. Writes
 *  `registry.active` and updates the in-memory active-account
 *  seam. Throws when the key is not present in the registry; the
 *  switch sequencer guarantees presence by calling
 *  `persistSessionForAccount` first. */
export function commitActiveAccount(accountKey: AccountKey): void {
  const reg = loadRegistry();
  if (reg === null || reg.accounts[accountKey] === undefined) {
    throw new Error(
      `commitActiveAccount: ${accountKey} not in registry`,
    );
  }
  saveRegistry(withActive(reg, accountKey));
  setActiveAccountKey(accountKey);
}

/** Clear the active account's persisted session and remove it
 *  from the registry. Equivalent to "log out current account".
 *  Active-account seam falls back to the legacy-default sentinel
 *  so subsequent module-level state reads (logs, errors, scroll
 *  positions) don't leak the old key.
 *
 *  Note: this is per-account logout. R7.3 will introduce
 *  "logout all accounts" as a separate destructive affordance. */
export function clearSession(): void {
  const reg = loadRegistry();
  if (reg === null || reg.active === null) return;
  const active = reg.active;
  clearAccountSession(active);
  saveRegistry(removeEntry(reg, active));
  // Reset the active-account seam. We don't have a "no active"
  // value in the AccountKey type, so fall back to the legacy
  // default sentinel — same place the seam started at boot.
  // R7.3's switcher will pick a different account explicitly.
  setActiveAccountKey(LEGACY_DEFAULT_ACCOUNT_KEY);
}
