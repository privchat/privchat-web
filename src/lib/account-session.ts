// R7.2a — namespaced session storage. Each known account has its own
// localStorage entry at `privchat.web.session.<accountKey>` carrying
// the existing `PersistedSession` shape. Splitting tokens out from
// the registry (which only holds non-sensitive metadata) means a
// "list known accounts" enumeration doesn't need to read every
// token blob, and adding/removing one account doesn't disturb the
// others' tokens.
//
// The shape of each blob is identical to the legacy single-session
// shape — that's deliberate: R7.2a's migration just COPIES the
// legacy blob under a namespaced key, no re-encoding.

import type { AccountKey } from './account-key';
import type { PersistedSession } from './session-storage';

const STORAGE_PREFIX = 'privchat.web.session.';

function storageKey(accountKey: AccountKey): string {
  return `${STORAGE_PREFIX}${accountKey}`;
}

export function loadAccountSession(
  accountKey: AccountKey,
): PersistedSession | null {
  try {
    const raw = window.localStorage.getItem(storageKey(accountKey));
    if (raw === null || raw === '') return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (
      typeof parsed.url !== 'string' ||
      typeof parsed.user_id !== 'string' ||
      typeof parsed.access_token !== 'string' ||
      typeof parsed.device_id !== 'string'
    ) {
      return null;
    }
    // R8.1 optional fields are passed through as-is when present.
    // Missing values mean "this blob was written by an R7-era
    // build" — readers default to builtin via `sessionAccountMode()`.
    return {
      url: parsed.url,
      user_id: parsed.user_id,
      access_token: parsed.access_token,
      device_id: parsed.device_id,
      saved_at: typeof parsed.saved_at === 'number' ? parsed.saved_at : 0,
      ...(parsed.account_mode !== undefined
        ? { account_mode: parsed.account_mode }
        : {}),
      ...(typeof parsed.platform_base_url === 'string'
        ? { platform_base_url: parsed.platform_base_url }
        : {}),
      ...(typeof parsed.refresh_token === 'string'
        ? { refresh_token: parsed.refresh_token }
        : {}),
    };
  } catch {
    return null;
  }
}

export function saveAccountSession(
  accountKey: AccountKey,
  session: Omit<PersistedSession, 'saved_at'>,
): void {
  try {
    const value: PersistedSession = { ...session, saved_at: Date.now() };
    window.localStorage.setItem(storageKey(accountKey), JSON.stringify(value));
  } catch {
    /* localStorage unavailable / quota — fall back to in-memory-only auth */
  }
}

export function clearAccountSession(accountKey: AccountKey): void {
  try {
    window.localStorage.removeItem(storageKey(accountKey));
  } catch {
    /* */
  }
}
