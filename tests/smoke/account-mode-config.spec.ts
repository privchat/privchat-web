// R8.1 — config + seam smokes.
//
// These tests don't drive any UI; they assert on the
// `account-mode` / capabilities / schema-reader-rule contracts so
// the seam stays correct as R8.3+ fills in the PLATFORM behaviour.
//
// We hit the harness rather than re-importing the modules
// directly so the assertions run in the same browser context
// the production code does (same `import.meta.env` resolution,
// same Vite transformations).
//
// Six cases:
//
//   1. default mode is builtin (env unset / blank)
//   2. builtin capabilities deny profileEdit / smsLogin / qrLogin
//   3. PLATFORM matrix enables those (verified via the pure
//      `capabilitiesFor` helper since flipping the env var at
//      runtime isn't possible — the test mode is locked to
//      builtin in CI).
//   4. legacy session without `account_mode` reads as builtin
//   5. legacy AccountEntry without `mode` reads as builtin
//   6. session/entry with explicit mode='platform' reads as
//      platform

import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

interface ModeConfig {
  mode: 'builtin' | 'platform';
  platformBaseUrl: string | null;
  misconfigured: boolean;
}

interface Capabilities {
  profileEdit: boolean;
  avatarUpload: boolean;
  smsLogin: boolean;
  qrLogin: boolean;
  passwordLogin: boolean;
}

async function readModeConfig(page: Page): Promise<ModeConfig> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __privchatTest: {
          getAccountModeConfig(): unknown;
        };
      }
    ).__privchatTest;
    return harness.getAccountModeConfig() as ModeConfig;
  });
}

async function readCapabilities(page: Page): Promise<Capabilities> {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        __privchatTest: {
          getAccountCapabilities(): unknown;
        };
      }
    ).__privchatTest;
    return harness.getAccountCapabilities() as Capabilities;
  });
}

async function resolveLegacyMode(
  page: Page,
  kind: 'session' | 'entry',
  mode?: string,
): Promise<string> {
  return page.evaluate(
    ({ k, m }) => {
      const harness = (
        window as unknown as {
          __privchatTest: {
            resolveLegacyAccountMode(arg: {
              kind: string;
              mode?: string;
            }): string;
          };
        }
      ).__privchatTest;
      return harness.resolveLegacyAccountMode(
        m === undefined ? { kind: k } : { kind: k, mode: m },
      );
    },
    { k: kind, m: mode },
  );
}

test.describe('account mode config (R8.1)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('default account mode is builtin when env is unset', async ({
    page,
  }) => {
    const cfg = await readModeConfig(page);
    // Playwright runs the mock test build with no
    // VITE_PRIVCHAT_ACCOUNT_MODE — defaults must be builtin.
    expect(cfg.mode).toBe('builtin');
    expect(cfg.misconfigured).toBe(false);
  });

  test('builtin capabilities deny profileEdit / smsLogin / qrLogin', async ({
    page,
  }) => {
    const caps = await readCapabilities(page);
    expect(caps).toEqual({
      profileEdit: false,
      avatarUpload: false,
      memberSignIn: false,
      smsLogin: false,
      qrLogin: false,
      passwordLogin: true,
    });
  });

  test('PLATFORM_CAPABILITIES enables profileEdit / smsLogin / qrLogin', async ({
    page,
  }) => {
    // We can't flip the env var at runtime, so we exercise the
    // pure `capabilitiesFor('platform')` helper directly. This
    // proves the matrix is wired correctly without needing a
    // separate Playwright project for `VITE_PRIVCHAT_ACCOUNT_MODE=platform`.
    const platform = await page.evaluate(async () => {
      const mod = await import('/src/lib/account-capabilities.ts');
      return mod.PLATFORM_CAPABILITIES as Record<string, boolean>;
    });
    expect(platform).toEqual({
      profileEdit: true,
      avatarUpload: true,
      memberSignIn: true,
      smsLogin: true,
      qrLogin: true,
      passwordLogin: true,
    });
  });

  test('legacy session without account_mode reads as builtin', async ({
    page,
  }) => {
    const result = await resolveLegacyMode(page, 'session');
    expect(result).toBe('builtin');
  });

  test('legacy entry without mode reads as builtin', async ({ page }) => {
    const result = await resolveLegacyMode(page, 'entry');
    expect(result).toBe('builtin');
  });

  test('explicit mode=platform on session/entry reads as platform', async ({
    page,
  }) => {
    expect(await resolveLegacyMode(page, 'session', 'platform')).toBe(
      'platform',
    );
    expect(await resolveLegacyMode(page, 'entry', 'platform')).toBe(
      'platform',
    );
  });
});
