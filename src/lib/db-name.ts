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

/** Legacy single-account DB name. Pre-R7.2b, every account shared
 *  this DB; we keep it as a fallback when DB migration fails so
 *  the user's existing cache stays accessible — R7.2b explicitly
 *  does NOT delete this DB after copy. R7.2c (or later) will clean
 *  it up after a dogfood window proves the account DB is intact. */
export const LEGACY_DB_NAME = 'privchat-web-dev';
