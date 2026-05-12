// R7.1 — types only. The shape of the persisted account registry.
// No reader / writer / migration is wired in this step; that's
// R7.2 (registry-of-one migration from the legacy single-session
// localStorage key) and R7.3 (switcher UI).
//
// See docs/MULTI_ACCOUNT_DESIGN.md for the persistence strategy:
//   - localStorage `privchat.web.accounts` → AccountRegistry
//   - localStorage `privchat.web.session.<accountKey>` → token
//     blob per account (existing PersistedSession shape)
//
// The registry holds NO tokens. Tokens are sensitive and
// per-account, so they live in a separate localStorage key
// keyed by `accountKey`. Splitting these means a "list of known
// accounts" enumeration doesn't need to read every token blob.

import type { AccountKey } from './account-key';

import type { AccountMode } from './account-mode';

/** One row in the registry. Tokens explicitly NOT here. */
export interface AccountEntry {
  /** Gateway URL the account belongs to. */
  url: string;
  /** Server-issued user id (string form). */
  user_id: string;
  /** SDK device id from the original login response. Stable
   *  across reconnects; needed to resume the same session. */
  device_id: string;
  /** User-set display alias (defaults to username at add time).
   *  Only used by the switcher UI (R7.3). */
  alias?: string;
  /** Avatar tint chosen by the switcher UI (or rotated on add).
   *  Stored alongside the account so the UI is stable across
   *  reloads. R7.3+. */
  color?: string;
  /** Wall-clock ms when the account was added. Drives switcher
   *  ordering ("most recent first") absent any explicit user
   *  preference. */
  added_at: number;
  /** R8.1 — which account system this entry was registered
   *  through. Reads default to `'builtin'` for entries written
   *  before R8.1 (see `entryAccountMode()`). R8.1 itself does
   *  not write this field; R8.3 add-account flow under PLATFORM
   *  mode does. */
  mode?: AccountMode;
  /** R8.1 — only present when `mode === 'platform'`. The
   *  platform host this account authenticates against; required
   *  to reconstruct the right `AccountAuthProvider` on auto-login. */
  platform_base_url?: string;
}

/** R8.1 reader rule: a missing `mode` field counts as `'builtin'`.
 *  Centralised so every consumer gets the same default and we
 *  can spot any place that bypasses it. */
export function entryAccountMode(entry: AccountEntry): AccountMode {
  return entry.mode ?? 'builtin';
}

/** Top-level registry shape. Persisted as a single JSON blob in
 *  `localStorage[REGISTRY_KEY]`. */
export interface AccountRegistry {
  /** All known accounts, keyed by `AccountKey`. */
  accounts: Record<AccountKey, AccountEntry>;
  /** The active account, or `null` if no accounts are registered
   *  (fresh install / post-logout-all). */
  active: AccountKey | null;
}

/** localStorage key for the registry. Distinct from the legacy
 *  single-account `privchat.web.session` key so R7.2 migration
 *  can detect the upgrade path cleanly. */
export const REGISTRY_KEY = 'privchat.web.accounts';
