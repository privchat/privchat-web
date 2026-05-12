// R7.1 — module-level "which account is currently active" pointer.
//
// Read by anything that wants to namespace its in-memory state
// (`scroll-positions`, future per-account audio queues, etc.) or
// auto-tag its captured side-effects (`error-reporter`,
// `log-buffer`).
//
// Today there's exactly one account, so this stays at its
// default value of `LEGACY_DEFAULT_ACCOUNT_KEY` forever — none of
// the seams end up doing anything different than the
// pre-R7 single-account behavior. R7.3's account-switcher will
// be the first caller to flip this.
//
// Subscribers exist for the future case where, e.g., the logs
// dialog wants to filter by current account in real time. R7.1
// doesn't add such consumers; the seam is just here.

import { LEGACY_DEFAULT_ACCOUNT_KEY, type AccountKey } from './account-key';

let active: AccountKey = LEGACY_DEFAULT_ACCOUNT_KEY;
const listeners = new Set<(key: AccountKey) => void>();

export function getActiveAccountKey(): AccountKey {
  return active;
}

/** Set the active account. Triggers a synchronous notification of
 *  every subscriber. Call this BEFORE mounting the new account's
 *  `PrivchatProvider` subtree, so any module-scoped state read
 *  during the new tree's first render sees the new key. */
export function setActiveAccountKey(next: AccountKey): void {
  if (active === next) return;
  active = next;
  for (const cb of listeners) cb(next);
}

/** Subscribe to active-account changes. Returns an `unsubscribe`
 *  thunk. The callback is NOT called with the current value at
 *  subscription time — read `getActiveAccountKey()` if you need
 *  that. */
export function subscribeActiveAccount(
  cb: (key: AccountKey) => void,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
