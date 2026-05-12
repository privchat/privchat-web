// R7.2a — one-shot migration from the legacy single-account session
// (`localStorage["privchat.web.session"]`) to the registry-of-one
// shape (`privchat.web.accounts` + `privchat.web.session.<key>`).
//
// Idempotent and re-entrant:
//   - If the registry already exists with an `active` set, we just
//     publish that key to the active-account seam and return.
//   - If the registry doesn't exist but a legacy session does,
//     we derive the AccountKey, write the namespaced session, write
//     the registry, then delete the legacy entry. Order matters
//     for crash safety: a partial migration on the next boot looks
//     like "registry exists with this account, legacy still
//     hanging around" and we just clean up the legacy on retry.
//   - If neither exists, we leave the active-account at its default
//     (`LEGACY_DEFAULT_ACCOUNT_KEY`) and return null. The login
//     page will run; once the user logs in, `saveSession` writes
//     directly into the namespaced shape.
//
// Lives separately from `session-storage.ts` so the migration code
// is one focused, deletable thing once the legacy key has been
// purged from the wild.

import { accountKeyFor, type AccountKey } from './account-key';
import { setActiveAccountKey } from './active-account';
import { saveAccountSession } from './account-session';
import {
  loadRegistry,
  saveRegistry,
  upsertEntry,
  withActive,
} from './account-registry-store';
import type { PersistedSession } from './session-storage';

const LEGACY_SESSION_KEY = 'privchat.web.session';

interface LegacySession extends PersistedSession {}

function readLegacySession(): LegacySession | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_SESSION_KEY);
    if (raw === null || raw === '') return null;
    const parsed = JSON.parse(raw) as Partial<LegacySession>;
    if (
      typeof parsed.url !== 'string' ||
      typeof parsed.user_id !== 'string' ||
      typeof parsed.access_token !== 'string' ||
      typeof parsed.device_id !== 'string'
    ) {
      return null;
    }
    return {
      url: parsed.url,
      user_id: parsed.user_id,
      access_token: parsed.access_token,
      device_id: parsed.device_id,
      saved_at: typeof parsed.saved_at === 'number' ? parsed.saved_at : 0,
    };
  } catch {
    return null;
  }
}

function deleteLegacySession(): void {
  try {
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    /* */
  }
}

/** Run the migration. Returns the active `AccountKey` (whether
 *  freshly migrated or already in the registry) or `null` when
 *  there's no session to migrate (clean install). Safe to call on
 *  every app boot — already-migrated installs short-circuit at
 *  step 1. */
export async function migrateLegacySessionToRegistryOfOne(): Promise<
  AccountKey | null
> {
  const reg = loadRegistry();

  // Path 1: registry already exists with an active account. Just
  // publish to the active-account seam.
  if (reg !== null && reg.active !== null) {
    setActiveAccountKey(reg.active);
    // Defensive: if a stale legacy entry is still around (a previous
    // migration failed mid-flight, or two tabs raced), delete it.
    deleteLegacySession();
    return reg.active;
  }

  const legacy = readLegacySession();

  // Path 2: nothing to migrate. Clean install / post-logout.
  if (legacy === null) {
    return null;
  }

  // Path 3: legacy exists, registry doesn't (or is empty). Migrate.
  const accountKey = await accountKeyFor(legacy.url, legacy.user_id);

  // Order: write namespaced session first, then registry, then
  // delete legacy. If we crash between any two steps, the next
  // boot recovers:
  //   - crash before namespaced write → legacy still there, retry from scratch
  //   - crash before registry write → namespaced exists but no registry;
  //     next boot re-derives from legacy, namespaced gets overwritten with
  //     same content (idempotent), registry gets written
  //   - crash before legacy delete → registry exists, next boot Path 1 cleans up
  saveAccountSession(accountKey, {
    url: legacy.url,
    user_id: legacy.user_id,
    access_token: legacy.access_token,
    device_id: legacy.device_id,
  });

  const baseReg = reg ?? { accounts: {}, active: null };
  const withEntry = upsertEntry(baseReg, accountKey, {
    url: legacy.url,
    user_id: legacy.user_id,
    device_id: legacy.device_id,
    added_at: legacy.saved_at > 0 ? legacy.saved_at : Date.now(),
  });
  const finalReg = withActive(withEntry, accountKey);
  saveRegistry(finalReg);

  deleteLegacySession();
  setActiveAccountKey(accountKey);
  return accountKey;
}
