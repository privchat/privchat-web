// R7.2a — legacy → registry-of-one session migration smoke.
//
// The production migration runner lives behind `App.tsx`'s
// auto-login useEffect; under Playwright we mount `TestApp` (no
// login flow), so the runner doesn't fire automatically. The test
// harness exposes the runner on `__privchatTest.runLegacySessionMigration()`
// purely so this spec can drive it deterministically without
// needing a real backend.
//
// Three paths from the design note are exercised:
//
//   1. Legacy session present, no registry → migrated. Registry
//      gains the account, namespaced session is written, legacy
//      key is removed.
//
//   2. Registry already exists with an active account → idempotent.
//      Migration short-circuits, doesn't re-derive, doesn't
//      overwrite the namespaced token. (Defensive: also cleans up
//      a stale legacy key if one is hanging around.)
//
//   3. No legacy, no registry → no-op. Returns null. localStorage
//      stays empty.

import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const LEGACY_KEY = 'privchat.web.session';
const REGISTRY_KEY = 'privchat.web.accounts';

interface LegacyBlob {
  url: string;
  user_id: string;
  access_token: string;
  device_id: string;
  saved_at: number;
}

const LEGACY: LegacyBlob = {
  url: 'ws://test-gw:9080/',
  user_id: '900001',
  access_token: 'tok-legacy',
  device_id: 'dev-legacy',
  saved_at: 1_700_000_000_000,
};

async function stageLegacy(page: Page, blob: LegacyBlob): Promise<void> {
  await page.addInitScript((entry) => {
    localStorage.setItem('privchat.web.session', JSON.stringify(entry));
  }, blob);
}

async function readStorage(
  page: Page,
  keyOrPrefix: string,
): Promise<Record<string, string>> {
  return page.evaluate((needle) => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === null) continue;
      if (k === needle || k.startsWith(`${needle}.`)) {
        out[k] = localStorage.getItem(k) ?? '';
      }
    }
    return out;
  }, keyOrPrefix);
}

async function runMigration(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const harness = (window as unknown as {
      __privchatTest: {
        runLegacySessionMigration(): Promise<string | null>;
      };
    }).__privchatTest;
    return harness.runLegacySessionMigration();
  });
}

test.describe('legacy session migration (R7.2a)', () => {
  test('migrates legacy session to registry + namespaced token', async ({
    page,
  }) => {
    await stageLegacy(page, LEGACY);
    await gotoAppFresh(page);

    // Pre-condition: only the legacy entry should be in localStorage,
    // gotoAppFresh's reset() doesn't touch our keys.
    const before = await page.evaluate(
      () => localStorage.getItem('privchat.web.session') !== null,
    );
    expect(before).toBe(true);

    const accountKey = await runMigration(page);
    expect(accountKey).not.toBeNull();
    expect(typeof accountKey).toBe('string');
    expect(accountKey).toMatch(/^[0-9a-f]{16}$/);

    // Legacy must be gone.
    const legacyAfter = await page.evaluate(() =>
      localStorage.getItem('privchat.web.session'),
    );
    expect(legacyAfter).toBeNull();

    // Registry must hold exactly one entry, with active set.
    const regRaw = await page.evaluate((k) => localStorage.getItem(k), REGISTRY_KEY);
    expect(regRaw).not.toBeNull();
    const reg = JSON.parse(regRaw!);
    expect(reg.active).toBe(accountKey);
    expect(Object.keys(reg.accounts)).toEqual([accountKey]);
    expect(reg.accounts[accountKey!].url).toBe(LEGACY.url);
    expect(reg.accounts[accountKey!].user_id).toBe(LEGACY.user_id);
    expect(reg.accounts[accountKey!].device_id).toBe(LEGACY.device_id);
    // Tokens must NOT be in the registry.
    expect(reg.accounts[accountKey!].access_token).toBeUndefined();

    // Namespaced session must hold the token.
    const sessRaw = await page.evaluate(
      (k) => localStorage.getItem(k),
      `privchat.web.session.${accountKey}`,
    );
    expect(sessRaw).not.toBeNull();
    const sess = JSON.parse(sessRaw!);
    expect(sess.url).toBe(LEGACY.url);
    expect(sess.user_id).toBe(LEGACY.user_id);
    expect(sess.access_token).toBe(LEGACY.access_token);
    expect(sess.device_id).toBe(LEGACY.device_id);
  });

  test('is idempotent — second run does not re-derive or overwrite', async ({
    page,
  }) => {
    await stageLegacy(page, LEGACY);
    await gotoAppFresh(page);

    const accountKey1 = await runMigration(page);
    expect(accountKey1).not.toBeNull();
    const sessAfterFirst = await readStorage(page, 'privchat.web.session');

    // Mutate the namespaced token to a sentinel; if the second run
    // overwrites it, this string would be lost.
    await page.evaluate(
      ({ k, v }) => {
        localStorage.setItem(k, v);
      },
      {
        k: `privchat.web.session.${accountKey1}`,
        v: JSON.stringify({
          ...JSON.parse(sessAfterFirst[`privchat.web.session.${accountKey1}`]!),
          access_token: 'sentinel-do-not-overwrite',
        }),
      },
    );

    const accountKey2 = await runMigration(page);
    expect(accountKey2).toBe(accountKey1);

    // Sentinel must still be there.
    const after = await page.evaluate(
      (k) => localStorage.getItem(k),
      `privchat.web.session.${accountKey1}`,
    );
    const sess = JSON.parse(after!);
    expect(sess.access_token).toBe('sentinel-do-not-overwrite');
  });

  test('cleans up a stale legacy entry when registry already exists', async ({
    page,
  }) => {
    // Stage BOTH a legacy entry and a registry — simulates a
    // previous migration that crashed after writing the registry
    // but before deleting the legacy key.
    await page.addInitScript(() => {
      localStorage.setItem(
        'privchat.web.session',
        JSON.stringify({
          url: 'ws://test-gw:9080/',
          user_id: '900001',
          access_token: 'stale-leftover',
          device_id: 'dev-legacy',
          saved_at: 1_700_000_000_000,
        }),
      );
      // A pre-existing registry, with a DIFFERENT account active —
      // proves migration doesn't repurpose the legacy entry.
      localStorage.setItem(
        'privchat.web.accounts',
        JSON.stringify({
          accounts: {
            '0123456789abcdef': {
              url: 'ws://other-gw:9080/',
              user_id: '700000',
              device_id: 'dev-other',
              added_at: 1_690_000_000_000,
            },
          },
          active: '0123456789abcdef',
        }),
      );
    });
    await gotoAppFresh(page);

    const result = await runMigration(page);
    expect(result).toBe('0123456789abcdef');

    // Legacy entry cleaned up.
    expect(
      await page.evaluate(() => localStorage.getItem('privchat.web.session')),
    ).toBeNull();

    // Registry untouched (still one entry, same active).
    const regRaw = await page.evaluate((k) => localStorage.getItem(k), REGISTRY_KEY);
    const reg = JSON.parse(regRaw!);
    expect(reg.active).toBe('0123456789abcdef');
    expect(Object.keys(reg.accounts)).toEqual(['0123456789abcdef']);
  });

  test('is a no-op when no legacy and no registry', async ({ page }) => {
    await gotoAppFresh(page);
    const result = await runMigration(page);
    expect(result).toBeNull();

    expect(
      await page.evaluate(() => localStorage.getItem('privchat.web.session')),
    ).toBeNull();
    expect(
      await page.evaluate((k) => localStorage.getItem(k), REGISTRY_KEY),
    ).toBeNull();
  });
});
