// PLATFORM SMS login UI smokes — two-step phone → OTP flow (Telegram-style).
//
// Forces PLATFORM mode + same-origin fake `platformBaseUrl` via
// `addInitScript` (window flags consulted by `account-mode.ts` only
// when `VITE_PRIVCHAT_TEST_MODE === 'mock'`). The provider factory
// then resolves to `PlatformAuthProvider` against the fake URL;
// `page.route()` mocks each endpoint per-test.
//
// TestApp renders LoginPage only via the add-account flow (the fake
// handle keeps ChatWorkspace mounted on first paint), so we stage
// Alice in the registry and click switcher → add-account before
// each test.
//
// Flow recap (post-Telegram-style refactor):
//   Step 'phone': country picker + national-number input → Continue
//   Step 'otp':   6-segmented digit boxes; auto-submits on complete
//
// What's covered (5 cases):
//   1. PLATFORM mode renders step-1 widgets; BUILTIN form widgets absent
//   2. Continue → POST /auth/send-sms-code with composed E.164 +
//      scene=1; advances to OTP step; resend cooldown engages
//   3. Empty phone number disables Continue (no HTTP call possible)
//   4. Successful flow (phone → OTP fills all 6 → auto-submit) persists
//      `account_mode` / `platform_base_url` / `refresh_token` to BOTH
//      the session blob AND the registry entry (R7/R8 compat invariant)
//   5. SMS login API error (`code !== 0`) surfaces server's `message`
//      verbatim and re-arms the OTP input for retry

import { expect, test, type Route } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const fillOtp = async (
  page: import('@playwright/test').Page,
  code: string,
): Promise<void> => {
  // Distributing across boxes via paste handler keeps the test
  // resilient to focus-advance timing. Paste lands on the first box;
  // the OtpInput's paste handler distributes the digits across all
  // boxes and the completion edge-trigger fires onComplete → submit.
  const first = page.getByTestId('login-otp-0');
  await first.click();
  await first.evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    input.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, code);
};

test.describe('platform SMS login UI (Telegram-style two-step)', () => {
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
    await page.getByTestId('account-switcher-trigger').click();
    await page.getByTestId('account-switcher-add').click();
  });

  test('PLATFORM mode renders phone step widgets; BUILTIN form widgets absent', async ({
    page,
  }) => {
    // Step 1 widgets:
    await expect(page.getByTestId('login-country-select')).toBeVisible();
    await expect(page.getByTestId('login-phone-number-input')).toBeVisible();
    await expect(page.getByTestId('login-phone-continue')).toBeVisible();

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

    // OTP step widgets must NOT be visible yet (we're on the phone step):
    await expect(page.getByTestId('login-otp-0')).toHaveCount(0);
  });

  test('Continue → POSTs E.164 + scene=1 and advances to OTP step with cooldown', async ({
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

    // Explicitly pick China (+86) — locale-dependent default would
    // otherwise vary by browser. Type just the national digits.
    await page.getByTestId('login-country-select').click();
    await page.getByTestId('country-select-item-CN').click();
    await page.getByTestId('login-phone-number-input').fill('13800138000');
    await page.getByTestId('login-phone-continue').click();

    // Step transition: phone widgets gone, OTP widgets present.
    await expect(page.getByTestId('login-otp-0')).toBeVisible();
    await expect(page.getByTestId('login-phone-number-input')).toHaveCount(0);
    await expect(page.getByTestId('login-otp-back')).toBeVisible();

    // Resend cooldown engages.
    await expect(page.getByTestId('login-otp-resend')).toContainText(/\d/);
    await expect(page.getByTestId('login-otp-resend')).toBeDisabled();

    expect(hitCount).toBe(1);
    expect(receivedBody).toEqual({
      mobile: '+8613800138000',
      scene: 1,
    });
  });

  test('empty national number disables Continue (no HTTP call)', async ({
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

    // Continue starts disabled (empty input → phoneValid false).
    await expect(page.getByTestId('login-phone-continue')).toBeDisabled();

    // Type a too-short number — still invalid E.164 → still disabled.
    await page.getByTestId('login-phone-number-input').fill('1');
    await expect(page.getByTestId('login-phone-continue')).toBeDisabled();

    // Idle long enough that nothing could have leaked through.
    await page.waitForTimeout(200);
    expect(hitCount).toBe(0);
  });

  test('successful flow (phone → OTP auto-submit) persists PLATFORM fields', async ({
    page,
  }) => {
    await page.route(
      '**/__fake-platform/app/auth/send-sms-code',
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"code":0,"data":null}',
        });
      },
    );
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

    // Distinct gateway so the derived accountKey differs from staged Alice.
    await page.locator('input#gateway').fill('ws://gw-bob/');
    await page.getByTestId('login-phone-number-input').fill('13800138000');
    await page.getByTestId('login-phone-continue').click();

    // OTP step. Paste in all 6 digits at once — auto-submit on complete.
    await expect(page.getByTestId('login-otp-0')).toBeVisible();
    await fillOtp(page, '123456');

    await page.waitForFunction(
      () => {
        const reg = JSON.parse(
          window.localStorage.getItem('privchat.web.accounts') ?? 'null',
        ) as { active?: string; accounts?: Record<string, unknown> } | null;
        if (reg === null || reg.active === undefined) return false;
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

    expect(persisted.session.account_mode).toBe('platform');
    expect(persisted.session.platform_base_url).toMatch(
      /\/__fake-platform\/app$/,
    );
    expect(persisted.session.refresh_token).toBe('refresh-jwt');
    expect(persisted.session.user_id).toBe('900002');
    expect(persisted.session.access_token).toBe('access-jwt');
    expect(persisted.session.device_id).toBe('dev-from-server');

    expect(persisted.entry?.mode).toBe('platform');
    expect(persisted.entry?.platform_base_url).toMatch(
      /\/__fake-platform\/app$/,
    );
    expect(persisted.entry?.user_id).toBe('900002');
  });

  test('sms-login API error surfaces server message verbatim + re-arms OTP', async ({
    page,
  }) => {
    await page.route(
      '**/__fake-platform/app/auth/send-sms-code',
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"code":0,"data":null}',
        });
      },
    );
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

    await page.getByTestId('login-phone-number-input').fill('13800138000');
    await page.getByTestId('login-phone-continue').click();
    await expect(page.getByTestId('login-otp-0')).toBeVisible();

    await fillOtp(page, '123456');

    // Server message passes through verbatim (PlatformApiError prefix-free).
    await expect(page.getByTestId('login-error')).toContainText(
      'invalid sms code',
    );

    // OtpInput cleared on failure so the user can retype:
    await expect(page.getByTestId('login-otp-0')).toHaveValue('');
    // Boxes still enabled (busy released after the error path).
    await expect(page.getByTestId('login-otp-0')).toBeEnabled();
  });
});
