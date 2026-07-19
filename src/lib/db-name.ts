// R7.2b — Dexie DB name helpers. One place to compute the
// per-account DB name; one place to keep the legacy single-account
// DB name. Lives outside `account-key.ts` so future R7 work that
// changes naming (versioning bump, prefix change) doesn't have to
// reach into the AccountKey type.

import type { AccountKey } from './account-key';

/** Production DB name for an account. R7.2b derives this from the
 *  active `AccountKey` (16 hex chars from
 *  `sha256(\`${url}|${user_id}\`)`); R7.3 will switch between names
 *  whenever the user changes accounts. */
export function accountDbName(accountKey: AccountKey): string {
  return `privchat-web-${accountKey}`;
}

/** Legacy single-account DB name. Pre-R7.2b, every account shared this DB.
 * It is now copy-only migration input and must never be opened by a live
 * authenticated client because it has no reliable account ownership. */
export const LEGACY_DB_NAME = 'privchat-web-dev';
