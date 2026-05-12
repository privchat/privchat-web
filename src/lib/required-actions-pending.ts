// R8.4c — localStorage flag for "user was last seen with pending actions".
//
// Spec PLATFORM_REQUIRED_ACTIONS_CONTRACT §8.
//
// Role: helper for fail-safe UI gating across page refreshes. Server
// `RequiredActionsProvider.list()` remains the authoritative truth on
// every boot. The flag only lets the splash know to show "checking"
// instead of "almost there" before list() returns. Auto-heals when
// server says clear (we always overwrite based on the list result).

import type { AccountKey } from './account-key';

const PREFIX = 'privchat.web.required-actions-pending.';

function storageKey(accountKey: AccountKey): string {
  return `${PREFIX}${accountKey}`;
}

export function isRequiredActionsPending(accountKey: AccountKey): boolean {
  try {
    return window.localStorage.getItem(storageKey(accountKey)) === 'true';
  } catch {
    return false;
  }
}

export function markRequiredActionsPending(accountKey: AccountKey): void {
  try {
    window.localStorage.setItem(storageKey(accountKey), 'true');
  } catch {
    /* quota / unavailable — UI gate still works on server signal */
  }
}

export function clearRequiredActionsPending(accountKey: AccountKey): void {
  try {
    window.localStorage.removeItem(storageKey(accountKey));
  } catch {
    /* */
  }
}
