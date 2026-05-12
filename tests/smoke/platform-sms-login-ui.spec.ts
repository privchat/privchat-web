// R8.3b — PLATFORM SMS login UI smokes.
//
// Forces PLATFORM mode + same-origin fake `platformBaseUrl` via
// `addInitScript` (window flags consulted by `account-mode.ts`
// only when `VITE_PRIVCHAT_TEST_MODE === 'mock'`). The provider
// factory then resolves to `PlatformAuthProvider` against the
// fake URL; `page.route()` mocks each endpoint per-test.
//
// TestApp renders LoginPage only via the add-account flow (the
// fake handle keeps ChatWorkspace mounted on first paint), so we
// stage Alice in the registry and click switcher → add-account
// before each test. TestApp's `onLoggedIn` mirrors App.tsx far
// enough to call `persistSessionForAccount` + `commitActiveAccount`,
// which is what test #4 reads back from localStorage.
//
// What's covered (5 cases):
//   1. PLATFORM mode renders SMS form; BUILTIN form widgets absent
//   2. Valid mobile + Send code → POST /auth/send-sms-code with
//      `scene: 1`; cooldown engages
//   3. Invalid mobile → inline error, NO HTTP call
//   4. Successful SMS login persists `account_mode` /
//      `platform_base_url` / `refresh_token` to BOTH the session
//      blob AND the registry entry (R7/R8 compat invariant)
//   5. SMS login API error (`code !== 0`) surfaces server's
//      `message` verbatim (PlatformApiError pass-through)

import { expect, test, type Route } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

/** Per-test setup: stage forced PLATFORM mode + same-origin fake
 *  base URL + a placeholder Alice in registry BEFORE the bundle
 *  loads. Window flags are consulted by account-mode.ts only in
 *  test mode; localStorage is consulted by TestApp's initial state. */
test.describe('platform SMS login UI (R8.3b)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__privchatForcedMode = 'platform';
      w.__privchatForcedPlatformBaseUrl =
        `${window.location.origin}/__fake-platform/app`;
      window.localStorage.setItem(
        'privchat.web.accounts',
        JSON.stringify({
          accounts: {
            '0123456789abcdef': {
              url: 'ws://gw-alice/',
              user_id: '900001',
              device_id: 'dev-alice',
              alias: 'Alice',
              added_at: 1_700_000_000_000,
              mode: 'platform',
              platform_base_url: 'https://app.example.com/app',
            },
          },
          active: '0123456789abcdef',
        }),
      );
    });
    await gotoAppFresh(page);
    // Open switcher → Add account → LoginPage mounts.
    await page.getByTestId('account-switcher-trigger').click();
    await page.getByTestId('account-switcher-add').click();
  });

  test('PLATFORM mode renders SMS form; BUILTIN form widgets absent', async ({
    page,
  }) => {
    await expect(page.getByTestId('login-mobile-input')).toBeVisible();
    await expect(page.getByTestId('login-sms-code-input')).toBeVisible();
    await expect(page.getByTestId('login-send-sms-code')).toBeVisible();
    await expect(page.getByTestId('login-sms-submit')).toBeVisible();

    // BUILTIN-only widgets must NOT render under PLATFORM:
    await expect(
      page.getByLabel(/^(Username|用户名|Tên đăng nhập)$/),
    ).toHaveCount(0);
    await expect(
      page.getByLabel(/^(Password|密码|Mật khẩu)$/),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^(Register|注册|Đăng ký)$/ }),
    ).toHaveCount(0);
  });

  test('valid mobile + Send code → POSTs scene=1 and engages cooldown', async ({
    page,
  }) => {
    let receivedBody: unknown = null;
    let hitCount = 0;
    await page.route(
      '**/__fake-platform/app/auth/send-sms-code',
      async (route: Route) => {
        hitCount += 1;
        receivedBody = JSON.parse(route.request().postData() ?? 'null');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: null }),
        });
      },
    );

    await page.getByTestId('login-mobile-input').fill('+8613800138000');
    await page.getByTestId('login-send-sms-code').click();

    // Wait until the cooldown text appears — `toContainText(/\d/)`
    // polls until a digit is in the button label, which only
    // happens after the request completes and cooldown engages
    // (the prior "Sending…" state has no digits).
    await expect(page.getByTestId('login-send-sms-code')).toContainText(
      /\d/,
    );
    await expect(page.getByTestId('login-send-sms-code')).toBeDisabled();

    expect(hitCount).toBe(1);
    expect(receivedBody).toEqual({
      mobile: '+8613800138000',
      scene: 1,
    });
  });

  test('invalid mobile blocks Send with inline error and NO HTTP call', async ({
    page,
  }) => {
    let hitCount = 0;
    await page.route(
      '**/__fake-platform/app/auth/send-sms-code',
      async (route: Route) => {
        hitCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"code":0,"data":null}',
        });
      },
    );

    await page.getByTestId('login-mobile-input').fill('123');
    await page.getByTestId('login-send-sms-code').click();

    // Inline error shown — copy includes "+8" example across all
    // locales' `error_invalid_mobile` strings.
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText('+');

    // Idle long enough that any in-flight request would have
    // landed on the route.
    await page.waitForTimeout(200);
    expect(hitCount).toBe(0);
    await expect(page.getByTestId('login-send-sms-code')).toBeEnabled();
  });

  test('successful SMS login persists PLATFORM fields to session + registry entry', async ({
    page,
  }) => {
    await page.route(
      '**/__fake-platform/app/auth/sms-login',
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              userId: 900_002,
              accessToken: 'access-jwt',
              refreshToken: 'refresh-jwt',
              deviceId: 'dev-from-server',
              tokenType: 'Bearer',
              expiresIn: 3_600,
              refreshExpiresIn: 604_800,
              sessionVersion: 3,
              deviceCreated: false,
            },
          }),
        });
      },
    );

    // Use a new gateway URL so the derived accountKey differs from
    // the staged Alice — that way the registry will gain a new
    // entry rather than overwriting Alice in place.
    await page
      .locator('input#gateway')
      .fill('ws://gw-bob/');
    await page.getByTestId('login-mobile-input').fill('+8613800138000');
    await page.getByTestId('login-sms-code-input').fill('123456');
    await page.getByTestId('login-sms-submit').click();

    // Wait until persistSessionForAccount + commitActiveAccount
    // have run (TestApp's onLoggedIn). The new account becomes
    // active in the registry.
    await page.waitForFunction(
      () => {
        const reg = JSON.parse(
          window.localStorage.getItem('privchat.web.accounts') ?? 'null',
        ) as { active?: string; accounts?: Record<string, unknown> } | null;
        if (reg === null || reg.active === undefined) return false;
        // Wait until the new (Bob) entry exists — i.e., the active
        // key isn't the staged Alice key.
        return reg.active !== '0123456789abcdef';
      },
      undefined,
      { timeout: 5_000 },
    );

    const persisted = await page.evaluate(() => {
      const reg = JSON.parse(
        window.localStorage.getItem('privchat.web.accounts')!,
      ) as {
        active: string;
        accounts: Record<string, Record<string, unknown>>;
      };
      const entry = reg.accounts[reg.active];
      const session = JSON.parse(
        window.localStorage.getItem(`privchat.web.session.${reg.active}`)!,
      ) as Record<string, unknown>;
      return { entry, session };
    });

    // Session blob carries all PLATFORM fields:
    expect(persisted.session.account_mode).toBe('platform');
    expect(persisted.session.platform_base_url).toMatch(
      /\/__fake-platform\/app$/,
    );
    expect(persisted.session.refresh_token).toBe('refresh-jwt');
    expect(persisted.session.user_id).toBe('900002');
    expect(persisted.session.access_token).toBe('access-jwt');
    expect(persisted.session.device_id).toBe('dev-from-server');

    // Registry entry mirrors mode + platformBaseUrl:
    expect(persisted.entry?.mode).toBe('platform');
    expect(persisted.entry?.platform_base_url).toMatch(
      /\/__fake-platform\/app$/,
    );
    expect(persisted.entry?.user_id).toBe('900002');
  });

  test('sms-login API error surfaces server message verbatim', async ({
    page,
  }) => {
    await page.route(
      '**/__fake-platform/app/auth/sms-login',
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 4002,
            message: 'invalid sms code',
          }),
        });
      },
    );

    await page.getByTestId('login-mobile-input').fill('+8613800138000');
    await page.getByTestId('login-sms-code-input').fill('123456');
    await page.getByTestId('login-sms-submit').click();

    // PlatformApiError pass-through: `message` shows verbatim,
    // not wrapped in any `t('login.error_sms_login', ...)` prefix.
    await expect(page.getByTestId('login-error')).toContainText(
      'invalid sms code',
    );
    // Login button re-enabled so the user can retry:
    await expect(page.getByTestId('login-sms-submit')).toBeEnabled();
  });
});
