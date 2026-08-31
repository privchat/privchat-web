// R8.3a — PlatformAuthProvider HTTP envelope client smokes.
//
// Constructs `PlatformAuthProvider` directly via test-harness
// methods (the production factory is BUILTIN in test builds; we
// don't flip the cached provider). HTTP traffic is intercepted
// with `page.route()` against a same-origin synthetic baseUrl so
// no CORS preflight is required.
//
// Each test mocks the specific endpoint(s) it exercises and lets
// the harness call `new PlatformAuthProvider(...).method(...)`.
// The discriminated `{ok, data}` / `{ok:false, errorName, ...}`
// return shape lets specs assert without try/catch in the page.

import { expect, test, type Page, type Route } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

/** Same-origin synthetic baseUrl: no CORS preflight, no real
 *  network. The `/__fake-platform/app` path is just a route
 *  pattern; nothing on disk responds to it. */
function fakeBaseUrl(originUrl: string): string {
  return `${originUrl}/__fake-platform/app`;
}

interface MockEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

async function fulfillJson<T>(
  route: Route,
  status: number,
  envelope: MockEnvelope<T> | string,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: typeof envelope === 'string' ? envelope : JSON.stringify(envelope),
  });
}

async function originOf(page: Page): Promise<string> {
  return page.evaluate(() => window.location.origin);
}

test.describe('PlatformAuthProvider HTTP envelope client (R8.3a)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('normalizePlatformBaseUrl: trim + strip trailing slash; require /app suffix', async ({
    page,
  }) => {
    // Lenient transforms — accept and normalize:
    const happy = await page.evaluate(async () =>
      (
        window as unknown as {
          __privchatTest: {
            platformNormalizeBaseUrl(input: string): Promise<unknown>;
          };
        }
      ).__privchatTest.platformNormalizeBaseUrl(
        '  https://app.example.com/app/  ',
      ),
    );
    expect(happy).toEqual({
      ok: true,
      result: 'https://app.example.com/app',
    });

    const insecurePublic = await page.evaluate(async () =>
      (
        window as unknown as {
          __privchatTest: {
            platformNormalizeBaseUrl(input: string): Promise<unknown>;
          };
        }
      ).__privchatTest.platformNormalizeBaseUrl(
        'http://106.55.63.153:8080/app',
      ),
    );
    expect(insecurePublic).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
      errorMessage: 'platformBaseUrl must use HTTPS outside local development',
    });

    // Strict — reject when /app is missing (no silent auto-append):
    const missingApp = await page.evaluate(async () =>
      (
        window as unknown as {
          __privchatTest: {
            platformNormalizeBaseUrl(input: string): Promise<unknown>;
          };
        }
      ).__privchatTest.platformNormalizeBaseUrl('https://app.example.com'),
    );
    expect(missingApp).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });

    // Empty input → also rejected:
    const empty = await page.evaluate(async () =>
      (
        window as unknown as {
          __privchatTest: {
            platformNormalizeBaseUrl(input: string): Promise<unknown>;
          };
        }
      ).__privchatTest.platformNormalizeBaseUrl('   '),
    );
    expect(empty).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });
  });

  test('sendSmsCode: code===0 with empty data resolves to cooldownSeconds=60', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let receivedBody: unknown = null;
    await page.route('**/__fake-platform/app/auth/send-sms-code', async (route) => {
      receivedBody = JSON.parse(route.request().postData() ?? 'null');
      await fulfillJson(route, 200, { code: 0, data: null });
    });

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformSendSmsCode(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformSendSmsCode(args),
    {
      baseUrl,
      mobile: '+8613800138000',
    });

    expect(out).toEqual({ ok: true, data: { cooldownSeconds: 60 } });
    expect(receivedBody).toEqual({
      mobile: '+8613800138000',
      // SCENE_LOGIN integer per server enum (NOT string 'login').
      scene: 1,
    });
  });

  test('sendSmsCode: code!==0 surfaces PlatformApiError with code+message', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route('**/__fake-platform/app/auth/send-sms-code', async (route) => {
      await fulfillJson(route, 200, {
        code: 4001,
        message: 'SMS code sending limit exceeded',
      });
    });

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformSendSmsCode(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformSendSmsCode(args),
    {
      baseUrl,
      mobile: '+8613800138000',
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformApiError',
      errorCode: 4001,
      errorMessage: 'SMS code sending limit exceeded',
    });
  });

  test('loginWithSms: maps unified-token data → LoginResult with accountMode=platform', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route('**/__fake-platform/app/auth/sms-login', async (route) => {
      await fulfillJson(route, 200, {
        code: 0,
        data: {
          userId: 900_001,
          accessToken: 'access-jwt',
          refreshToken: 'refresh-jwt',
          deviceId: 'dev-from-server',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshExpiresIn: 604_800,
          sessionVersion: 3,
          deviceCreated: false,
        },
      });
    });

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformLoginWithSms(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformLoginWithSms(args),
    {
      baseUrl,
      serverUrl: 'ws://gw.example/',
      mobile: '+8613800138000',
      smsCode: '123456',
    });

    expect(out).toEqual({
      ok: true,
      data: {
        // serverUrl passes THROUGH from the input; provider never
        // contacts it. UI captured it from env / form before calling.
        serverUrl: 'ws://gw.example/',
        // userId widened from number → string at provider layer
        // (avoid JS number precision near uid 2^53).
        userId: '900001',
        accessToken: 'access-jwt',
        deviceId: 'dev-from-server',
        accountMode: 'platform',
        platformBaseUrl: baseUrl,
        refreshToken: 'refresh-jwt',
        // R8.4b — wire-defense: server omitted requiredActions in
        // the mock response, provider materializes empty array.
        requiredActions: [],
      },
    });
  });

  test('loginWithSms: HTTP 500 surfaces PlatformHttpError with status', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route('**/__fake-platform/app/auth/sms-login', async (route) => {
      await fulfillJson(route, 500, 'oh no');
    });

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformLoginWithSms(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformLoginWithSms(args),
    {
      baseUrl,
      serverUrl: 'ws://gw.example/',
      mobile: '+8613800138000',
      smsCode: '123456',
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformHttpError',
      errorStatus: 500,
    });
  });

  test('refreshToken: success rotates access; deviceId echo wins; uid round-trips', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let receivedBody: unknown = null;
    await page.route('**/__fake-platform/app/auth/refresh-token', async (route) => {
      receivedBody = JSON.parse(route.request().postData() ?? 'null');
      await fulfillJson(route, 200, {
        code: 0,
        data: {
          userId: 900_001,
          accessToken: 'access-jwt-new',
          refreshToken: 'refresh-jwt-rotated',
          deviceId: 'dev-from-server',
          sessionVersion: 4,
          deviceCreated: false,
        },
      });
    });

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformRefreshToken(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformRefreshToken(args),
    {
      baseUrl,
      url: 'ws://gw.example/',
      userId: '900001',
      deviceId: 'dev-local',
      accessToken: 'access-jwt-old',
      refreshToken: 'refresh-jwt-old',
    });

    expect(out).toMatchObject({
      ok: true,
      data: {
        url: 'ws://gw.example/',
        user_id: '900001',
        access_token: 'access-jwt-new',
        refresh_token: 'refresh-jwt-rotated',
        // server-echoed deviceId wins when non-empty (Phase A
        // typically returns the same id back; this proves we
        // honor a server-rotated value).
        device_id: 'dev-from-server',
        account_mode: 'platform',
        platform_base_url: baseUrl,
      },
    });
    expect(receivedBody).toEqual({
      refreshToken: 'refresh-jwt-old',
      deviceId: 'dev-local',
    });
  });

  test('refreshToken: uid mismatch surfaces PlatformConfigError', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route('**/__fake-platform/app/auth/refresh-token', async (route) => {
      await fulfillJson(route, 200, {
        code: 0,
        data: {
          userId: 999_999,  // mismatched
          accessToken: 'access-jwt-new',
          refreshToken: 'refresh-jwt-old',
          deviceId: 'dev-local',
        },
      });
    });

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformRefreshToken(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformRefreshToken(args),
    {
      baseUrl,
      url: 'ws://gw.example/',
      userId: '900001',
      deviceId: 'dev-local',
      accessToken: 'access-jwt-old',
      refreshToken: 'refresh-jwt-old',
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });
    expect(
      (out as { errorMessage: string }).errorMessage,
    ).toContain('uid mismatch');
  });
});
