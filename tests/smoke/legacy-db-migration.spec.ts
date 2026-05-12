// R7.2b — legacy → account-keyed Dexie DB copy smoke.
//
// Four scenarios, all driven through the harness's exposed
// `runLegacyDbMigration(accountKey)` so we don't need a real
// backend or actual login:
//
//   1. Legacy DB exists, account DB doesn't, no marker → copy.
//      The marker is written. Legacy is NOT deleted (R7.2b's
//      conservative posture; R7.2c+ does the cleanup).
//
//   2. Marker already written → idempotent skip. Legacy is left
//      alone.
//
//   3. Account DB already has data → skipped-existing. The
//      marker is written so subsequent boots short-circuit at
//      step 1. Legacy is left alone.
//
//   4. Neither legacy nor account DB has data → no-legacy. The
//      marker is written.
//
// We don't try to assert on full row equality post-copy: that's
// what `Dexie.bulkPut` does internally and it has its own test
// surface. We assert on outcome + marker + legacy-DB existence,
// which are the contracts the rest of R7 cares about.

import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const LEGACY_DB_NAME = 'privchat-web-dev';
const ACCOUNT_KEY = '0123456789abcdef';
const ACCOUNT_DB_NAME = `privchat-web-${ACCOUNT_KEY}`;
const MARKER_KEY = `privchat.web.migration.db.${ACCOUNT_KEY}`;
const MARKER_VALUE_V1 = 'copied-from-legacy-v1';

// Each helper just forwards to a harness method exposed on
// `window.__privchatTest`. The harness side owns Dexie / CacheDB
// imports — `page.evaluate` itself can't resolve `dexie` because
// strings sent into the page have no Vite transform.

interface HarnessDbApi {
  seedDbWithChannel(dbName: string, channelId: string): Promise<void>;
  dbCountChannels(dbName: string): Promise<number>;
  dbExists(dbName: string): Promise<boolean>;
  dbDelete(dbName: string): Promise<void>;
  runLegacyDbMigration(accountKey: string): Promise<string>;
}

function call<K extends keyof HarnessDbApi>(
  page: Page,
  fn: K,
  ...args: Parameters<HarnessDbApi[K]>
): Promise<Awaited<ReturnType<HarnessDbApi[K]>>> {
  return page.evaluate(
    async ({ name, callArgs }) => {
      const harness = (window as unknown as {
        __privchatTest: Record<string, (...a: unknown[]) => unknown>;
      }).__privchatTest;
      return await harness[name]!(...callArgs);
    },
    { name: fn as string, callArgs: args as unknown[] },
  ) as Promise<Awaited<ReturnType<HarnessDbApi[K]>>>;
}

test.describe('legacy DB migration (R7.2b)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
    // Reset from prior workers.
    await page.evaluate((marker) => {
      localStorage.removeItem(marker);
    }, MARKER_KEY);
    if (await call(page, 'dbExists', LEGACY_DB_NAME)) {
      await call(page, 'dbDelete', LEGACY_DB_NAME);
    }
    if (await call(page, 'dbExists', ACCOUNT_DB_NAME)) {
      await call(page, 'dbDelete', ACCOUNT_DB_NAME);
    }
  });

  test('copies legacy DB to account DB and writes marker', async ({ page }) => {
    await call(page, 'seedDbWithChannel', LEGACY_DB_NAME, 'ch-legacy-1');

    const outcome = await call(page, 'runLegacyDbMigration', ACCOUNT_KEY);
    expect(outcome).toBe('copied');

    // Marker written.
    const marker = await page.evaluate(
      (k) => localStorage.getItem(k),
      MARKER_KEY,
    );
    expect(marker).toBe(MARKER_VALUE_V1);

    // Account DB has the seeded row.
    expect(await call(page, 'dbCountChannels', ACCOUNT_DB_NAME)).toBe(1);

    // Legacy DB INTENTIONALLY still around (R7.2b doesn't delete).
    expect(await call(page, 'dbExists', LEGACY_DB_NAME)).toBe(true);
    expect(await call(page, 'dbCountChannels', LEGACY_DB_NAME)).toBe(1);
  });

  test('skips when marker is already present (idempotent)', async ({ page }) => {
    await call(page, 'seedDbWithChannel', LEGACY_DB_NAME, 'ch-legacy-2');
    // Pre-seed marker as if a prior boot already migrated.
    await page.evaluate(
      ({ k, v }) => {
        localStorage.setItem(k, v);
      },
      { k: MARKER_KEY, v: MARKER_VALUE_V1 },
    );

    const outcome = await call(page, 'runLegacyDbMigration', ACCOUNT_KEY);
    expect(outcome).toBe('skipped-marked');

    // Account DB never opened: stays absent.
    expect(await call(page, 'dbExists', ACCOUNT_DB_NAME)).toBe(false);
    // Legacy DB untouched.
    expect(await call(page, 'dbExists', LEGACY_DB_NAME)).toBe(true);
  });

  test('skips and writes marker when account DB already has data', async ({
    page,
  }) => {
    await call(page, 'seedDbWithChannel', LEGACY_DB_NAME, 'ch-legacy-3');
    // Account DB pre-populated — e.g. fresh-install login already
    // wrote channels here. Don't clobber with stale legacy content.
    await call(page, 'seedDbWithChannel', ACCOUNT_DB_NAME, 'ch-account-pre-existing');

    const outcome = await call(page, 'runLegacyDbMigration', ACCOUNT_KEY);
    expect(outcome).toBe('skipped-existing');

    // Marker is written so we don't re-probe on every boot.
    const marker = await page.evaluate(
      (k) => localStorage.getItem(k),
      MARKER_KEY,
    );
    expect(marker).toBe(MARKER_VALUE_V1);

    // Account DB still has its pre-existing data, NOT clobbered.
    expect(await call(page, 'dbCountChannels', ACCOUNT_DB_NAME)).toBe(1);
  });

  test('no-op when neither legacy nor account DB exists', async ({ page }) => {
    const outcome = await call(page, 'runLegacyDbMigration', ACCOUNT_KEY);
    expect(outcome).toBe('no-legacy');

    // Marker still gets written so we don't re-probe.
    expect(
      await page.evaluate((k) => localStorage.getItem(k), MARKER_KEY),
    ).toBe(MARKER_VALUE_V1);

    // No DBs created with data as a side effect of the probe.
    expect(await call(page, 'dbExists', LEGACY_DB_NAME)).toBe(false);
    // The account-DB existence probe opens it briefly (which DOES
    // create the DB at version 0). Either way, it must have zero
    // channels rows.
    if (await call(page, 'dbExists', ACCOUNT_DB_NAME)) {
      expect(await call(page, 'dbCountChannels', ACCOUNT_DB_NAME)).toBe(0);
    }
  });
});
