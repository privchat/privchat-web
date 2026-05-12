// R8.2 — BUILTIN auth seam regression smokes.
//
// LoginPage now routes both login and register through
// `getAuthProvider()`. These specs verify the provider is the
// one that gets resolved, has the right method shape (login +
// register present, sms + logout absent for builtin), and that
// the temp-client lifecycle inside `BuiltinAuthProvider`
// actually runs end-to-end against an unreachable URL — i.e.
// the `connect → throw → dispose-in-finally` chain is reachable
// from a Playwright-driven harness call (no browser-side mocks).
//
// We deliberately don't test "successful login → ChatWorkspace"
// here because it'd need a live `privchat-server`. The 38
// existing plain e2e specs cover every other path that touches
// the LoginPage / Add-account flow; if R8.2's refactor broke
// the LoginPage UI, those would have caught it. This file
// covers the seam-specific contracts only.

import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

interface AuthProviderShape {
  mode: 'builtin' | 'platform';
  hasLoginWithPassword: boolean;
  hasRegisterWithPassword: boolean;
  hasLoginWithSms: boolean;
  hasRefreshToken: boolean;
  hasLogout: boolean;
}

async function describeProvider(page: Page): Promise<AuthProviderShape> {
  return page.evaluate(async () => {
    const harness = (
      window as unknown as {
        __privchatTest: { describeAuthProvider(): Promise<unknown> };
      }
    ).__privchatTest;
    return (await harness.describeAuthProvider()) as AuthProviderShape;
  });
}

test.describe('builtin auth provider integration (R8.2)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('production resolves BuiltinAuthProvider in builtin mode', async ({
    page,
  }) => {
    const desc = await describeProvider(page);
    expect(desc.mode).toBe('builtin');
    // BUILTIN's interface contract:
    //   loginWithPassword     — required
    //   registerWithPassword  — present (BUILTIN-only extension)
    //   refreshToken          — present (no-op passthrough)
    //   loginWithSms          — absent (UI gates by capability)
    //   logout                — absent (clearSession() suffices)
    expect(desc.hasLoginWithPassword).toBe(true);
    expect(desc.hasRegisterWithPassword).toBe(true);
    expect(desc.hasRefreshToken).toBe(true);
    expect(desc.hasLoginWithSms).toBe(false);
    expect(desc.hasLogout).toBe(false);
  });

  test('temp-client lifecycle runs end-to-end against an unreachable URL', async ({
    page,
  }) => {
    // The provider must:
    //   1. construct a temp client (createPrivchat)
    //   2. call .connect()  → which fails because the URL is dead
    //   3. throw the connect error to the caller
    //   4. dispose the temp client in `finally` so subsequent
    //      attempts aren't gated on a leaked websocket
    //
    // We can't directly inspect step 4 (no public "is disposed"
    // API on the SDK client), so we exercise the path twice
    // back-to-back and assert both attempts produce a clean
    // error rather than the second one failing on a leaked
    // resource.
    const first = await page.evaluate(async () => {
      const harness = (
        window as unknown as {
          __privchatTest: {
            triggerBuiltinLoginAgainstBadUrl(): Promise<unknown>;
          };
        }
      ).__privchatTest;
      return (await harness.triggerBuiltinLoginAgainstBadUrl()) as {
        threw: boolean;
        errorMessage: string;
      };
    });
    expect(first.threw).toBe(true);
    expect(first.errorMessage).not.toBe('');

    // Second attempt — proves the provider's dispose-in-finally
    // ran and didn't lock subsequent calls out.
    const second = await page.evaluate(async () => {
      const harness = (
        window as unknown as {
          __privchatTest: {
            triggerBuiltinLoginAgainstBadUrl(): Promise<unknown>;
          };
        }
      ).__privchatTest;
      return (await harness.triggerBuiltinLoginAgainstBadUrl()) as {
        threw: boolean;
        errorMessage: string;
      };
    });
    expect(second.threw).toBe(true);
    expect(second.errorMessage).not.toBe('');
  });

  test('LoginPage in add-account flow renders without provider error', async ({
    page,
  }) => {
    // R8.2 changed LoginPage's submit() to call through the
    // provider. The add-account UI test (R7.5 case 2) already
    // covers the Cancel path; this case adds a positive check
    // that just OPENING the LoginPage under add-account doesn't
    // crash on the new `getAuthProvider()` import path.
    //
    // Stage Alice in the registry so add-account UI is reachable.
    await page.addInitScript(() => {
      localStorage.setItem(
        'privchat.web.accounts',
        JSON.stringify({
          accounts: {
            '0123456789abcdef': {
              url: 'ws://gw-alice/',
              user_id: '900001',
              device_id: 'dev-alice',
              alias: 'Alice',
              added_at: 1_700_000_000_000,
            },
          },
          active: '0123456789abcdef',
        }),
      );
    });
    await gotoAppFresh(page);

    // Open switcher → click Add account → LoginPage should mount
    // and render the username/password form. If the provider
    // import path was broken (cyclical dep, throw at module
    // load, etc.) this would surface here as a missing form.
    await page.getByTestId('account-switcher-trigger').click();
    await page.getByTestId('account-switcher-add').click();
    await expect(page.getByLabel(/Username|用户名/)).toBeVisible();
    await expect(page.getByLabel(/Password|密码/)).toBeVisible();
    // Login + Register buttons should both render under BUILTIN
    // (capability gate doesn't strip them).
    await expect(
      page.getByRole('button', { name: /^(Login|登录|Đăng nhập)$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^(Register|注册|Đăng ký)$/ }),
    ).toBeVisible();
  });
});
