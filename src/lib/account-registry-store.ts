// R7.2a — registry persistence primitives. Tokens are NOT here
// (those live in `account-session.ts` per-accountKey). Only
// non-sensitive metadata: gateway url, user id, device id, optional
// alias / color, added_at timestamp.
//
// The whole registry is serialised as a single JSON blob under
// `privchat.web.accounts`. Reads / writes are sync (localStorage)
// and small (a handful of accounts max in v1).

import type { AccountKey } from './account-key';
import type { AccountEntry, AccountRegistry } from './account-registry';
import { REGISTRY_KEY } from './account-registry';

export function loadRegistry(): AccountRegistry | null {
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY);
    if (raw === null || raw === '') return null;
    const parsed = JSON.parse(raw) as Partial<AccountRegistry>;
    if (parsed === null || typeof parsed !== 'object') return null;
    if (typeof parsed.accounts !== 'object' || parsed.accounts === null) {
      return null;
    }
    // active is `AccountKey | null` — accept either.
    const active =
      typeof parsed.active === 'string' ? (parsed.active as AccountKey) : null;
    return {
      accounts: parsed.accounts as Record<AccountKey, AccountEntry>,
      active,
    };
  } catch {
    return null;
  }
}

export function saveRegistry(reg: AccountRegistry): void {
  try {
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
  } catch {
    /* localStorage unavailable / quota — caller can still proceed
     *  in-memory; auto-login next session may not work. */
  }
  notifyRegistry();
}

// R7.3 — registry change notification. The account switcher
// subscribes so it re-renders after saveSession (login/add) and
// after the active-account seam flips. Same shape as the active-
// account seam to keep both consumable from `useSyncExternalStore`.
type RegistryListener = () => void;
const registryListeners = new Set<RegistryListener>();

function notifyRegistry(): void {
  for (const cb of registryListeners) cb();
}

export function subscribeRegistry(cb: RegistryListener): () => void {
  registryListeners.add(cb);
  return () => {
    registryListeners.delete(cb);
  };
}

export function clearRegistry(): void {
  try {
    window.localStorage.removeItem(REGISTRY_KEY);
  } catch {
    /* */
  }
  notifyRegistry();
}

/** Insert / overwrite an entry. Pure function — does not write to
 *  storage; caller passes the result to `saveRegistry`. */
export function upsertEntry(
  reg: AccountRegistry,
  accountKey: AccountKey,
  entry: AccountEntry,
): AccountRegistry {
  return {
    ...reg,
    accounts: { ...reg.accounts, [accountKey]: entry },
  };
}

/** Remove an entry by key. If `active === accountKey`, also clear
 *  active. Pure function. */
export function removeEntry(
  reg: AccountRegistry,
  accountKey: AccountKey,
): AccountRegistry {
  const { [accountKey]: _removed, ...rest } = reg.accounts;
  void _removed;
  return {
    accounts: rest,
    active: reg.active === accountKey ? null : reg.active,
  };
}

/** Set the active account. Throws when `accountKey` is not in the
 *  registry — callers are expected to upsert first. Pure function. */
export function withActive(
  reg: AccountRegistry,
  accountKey: AccountKey | null,
): AccountRegistry {
  if (accountKey !== null && reg.accounts[accountKey] === undefined) {
    throw new Error(
      `account-registry: cannot set active to unknown key ${accountKey}`,
    );
  }
  return { ...reg, active: accountKey };
}
