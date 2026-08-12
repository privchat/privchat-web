// R7.2b — copy the legacy `privchat-web-dev` Dexie database into
// the active account's `privchat-web-<accountKey>` database.
//
// Conservative strategy: COPY, never delete. The legacy DB stays
// in place after a successful copy so a copy bug can be rolled
// back by simply pointing `createPrivchat` at `LEGACY_DB_NAME`.
// R7.2c / R7.4 will revisit deletion once a dogfood window
// confirms the account DB is intact.
//
// Marker design:
//   localStorage[privchat.web.migration.db.<accountKey>] = "copied-from-legacy-v1"
//
// The `-v1` suffix is forward-compatible: if a future bug
// requires re-running migration, we stamp `-v2` etc. and
// re-trigger. R7.2b only ever writes v1.
//
// Schema reuse: we open both legacy and target with `CacheDB`
// (re-exported from `@privchat/sdk` in R7.2b). This guarantees
// the schema definition is the SAME single source of truth the
// SDK uses for production reads / writes. Defining a separate
// schema here would risk drift; if the SDK adds a v7 table
// later, this migrator picks it up via the re-export without a
// code change.

import { CacheDB } from '@privchat/sdk/cache-idb';
import type { AccountKey } from './account-key';
import { accountDbName, LEGACY_DB_NAME } from './db-name';

/** Outcome of one migration attempt. UI doesn't surface these
 *  directly today; they exist as a deterministic test signal +
 *  dogfood logging hint. */
export type DbMigrationOutcome =
  | 'copied'
  | 'skipped-marked'
  | 'skipped-existing'
  | 'no-legacy';

const MARKER_PREFIX = 'privchat.web.migration.db.';
const MARKER_VALUE_V1 = 'copied-from-legacy-v1';

/** Global "legacy DB already consumed" marker. Set as soon as the
 *  first account either successfully imports legacy data OR observes
 *  no legacy DB to import. From that point on, every subsequent
 *  account in the same browser starts with an EMPTY per-account
 *  cache — the legacy copy is a one-time bootstrap, not a per-account
 *  template. Without this gate, every new account would re-copy the
 *  legacy DB's residual rows, leaking the first user's data into
 *  every subsequent login. */
const LEGACY_CONSUMED_KEY = `${MARKER_PREFIX}legacy_consumed`;
const LEGACY_CONSUMED_VALUE = 'v1';

function markerKey(accountKey: AccountKey): string {
  return `${MARKER_PREFIX}${accountKey}`;
}

function readMarker(accountKey: AccountKey): string | null {
  try {
    return window.localStorage.getItem(markerKey(accountKey));
  } catch {
    return null;
  }
}

function writeMarker(accountKey: AccountKey, value: string): void {
  try {
    window.localStorage.setItem(markerKey(accountKey), value);
  } catch {
    /* localStorage unavailable; the next boot will retry the
     *  migration. Idempotent up to whatever copy already
     *  happened. */
  }
}

function isLegacyConsumed(): boolean {
  try {
    return window.localStorage.getItem(LEGACY_CONSUMED_KEY) !== null;
  } catch {
    return false;
  }
}

function markLegacyConsumed(): void {
  try {
    window.localStorage.setItem(LEGACY_CONSUMED_KEY, LEGACY_CONSUMED_VALUE);
  } catch {
    /* localStorage unavailable — next boot re-evaluates. The
     *  per-account marker still gates against a second copy into
     *  the same account; the cross-account leak risk is only
     *  present in this rare degraded-storage case. */
  }
}

/** Returns the count of rows in the `channels` table — a fast
 *  "is this DB populated" probe. The Dexie `count()` API is
 *  cheap (uses the IDB index) so we don't pay for a full scan.
 *
 *  We deliberately don't enumerate all tables: a fresh CacheDB
 *  always has all object stores present, but `count() > 0` on
 *  ANY of them indicates "do not overwrite". `channels` is the
 *  most populated table on a typical install (every conversation
 *  ever opened is there) so it's the right canary. */
async function probeAccountDbHasData(accountKey: AccountKey): Promise<boolean> {
  const db = new CacheDB(accountDbName(accountKey));
  try {
    await db.open();
    const channelCount = await db.channels.count();
    return channelCount > 0;
  } catch {
    // If the account DB can't even be opened, we treat that as
    // "no data" — the copy will create / populate it fresh.
    return false;
  } finally {
    db.close();
  }
}

/** Copy every row from every Dexie-recognised table in `src` to
 *  `dst`. Per-table bulkPut so a single bad row in one table
 *  doesn't abort the whole copy. */
async function copyAllTables(src: CacheDB, dst: CacheDB): Promise<void> {
  for (const srcTable of src.tables) {
    const rows = await srcTable.toArray();
    if (rows.length === 0) continue;
    const dstTable = dst.table(srcTable.name);
    await dstTable.bulkPut(rows);
  }
}

/** Run the legacy → account DB copy.
 *
 *  Returns one of four outcomes:
 *    - `'skipped-marked'`: marker already exists, this account has
 *      been migrated before. No-op.
 *    - `'skipped-existing'`: account DB already has data (e.g. the
 *      user logged in fresh on this account, no need to import
 *      legacy). Marker is written so subsequent boots short-circuit.
 *    - `'no-legacy'`: legacy DB doesn't exist (clean install /
 *      already-cleaned-up). Marker is written.
 *    - `'copied'`: legacy → account copy succeeded. Marker is
 *      written. Legacy DB is INTENTIONALLY NOT deleted —
 *      see file header.
 *
 *  Throws when the actual `bulkPut` step fails (caller continues with the
 *  isolated account DB; SDK ownership verification resets any partial copy).
 *  Anything before the copy step is best-effort and
 *  swallowed into the relevant outcome. */
export async function migrateLegacyDbToAccountDb(
  accountKey: AccountKey,
): Promise<DbMigrationOutcome> {
  // 1. Marker fast path.
  if (readMarker(accountKey) === MARKER_VALUE_V1) {
    return 'skipped-marked';
  }

  // 2. Account DB already populated? Don't overwrite.
  if (await probeAccountDbHasData(accountKey)) {
    writeMarker(accountKey, MARKER_VALUE_V1);
    return 'skipped-existing';
  }

  // 3. Cross-account leak gate: the legacy → account copy is a
  // one-time bootstrap, not a per-account template. Once any
  // account has consumed (or skipped) the legacy DB, every
  // subsequent new account in this browser starts with an empty
  // cache. Without this check, adding account B after account A
  // imports A's friends / channels / messages into B's DB.
  if (isLegacyConsumed()) {
    writeMarker(accountKey, MARKER_VALUE_V1);
    return 'no-legacy';
  }

  // 4. Legacy DB exists?
  const legacyExists = await CacheDB.exists(LEGACY_DB_NAME);
  if (!legacyExists) {
    // First account in this browser AND no legacy data to import —
    // mark legacy consumed so future accounts (even on a different
    // dogfood device that later imports state) don't re-evaluate.
    markLegacyConsumed();
    writeMarker(accountKey, MARKER_VALUE_V1);
    return 'no-legacy';
  }

  // 5. Copy.
  const src = new CacheDB(LEGACY_DB_NAME);
  const dst = new CacheDB(accountDbName(accountKey));
  try {
    await src.open();
    await dst.open();
    await copyAllTables(src, dst);
  } finally {
    // Always close handles, even on error, so a retry on the next
    // boot can re-open without a "blocked" upgrade event.
    src.close();
    dst.close();
  }

  // 6. Markers written ONLY after a successful copy. The global
  // `legacy_consumed` marker prevents subsequent accounts from
  // re-copying the legacy DB. A throw before this line short-
  // circuits — the next boot retries the copy from scratch.
  markLegacyConsumed();
  writeMarker(accountKey, MARKER_VALUE_V1);
  return 'copied';
}

/** Resolve the Dexie DB name to use for the active account's
 *  PrivchatClient. Runs the legacy-copy migration as a side effect.
 *  Migration failure must NEVER fall back to the shared legacy database:
 *  availability degradation is preferable to cross-account data exposure.
 *  The SDK's cache-owner guard safely resets a partial account copy after
 *  authentication.
 *
 *  This is the single function `App.tsx` should call between
 *  session migration and `createPrivchat`. */
export async function resolveDbNameForActiveAccount(
  accountKey: AccountKey,
  onError?: (err: unknown) => void,
): Promise<string> {
  try {
    await migrateLegacyDbToAccountDb(accountKey);
  } catch (err) {
    onError?.(err);
  }
  return accountDbName(accountKey);
}
