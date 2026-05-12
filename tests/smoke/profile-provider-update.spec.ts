// R8.4d-1 — PlatformProfileProvider new field updates smokes.
//
// Provider-level tests for the three additional update methods that
// R8.4d-1 promoted from `NotImplementedYetError` stubs to real HTTP:
//   - updateBio
//   - updateGender
//   - updateBirthday
//
// Same harness pattern as R8.4b's required-actions-provider spec:
// construct PlatformProfileProvider directly via test control, mock
// HTTP with page.route, assert wire body / error class. UI integration
// (dialog open / save flow) is best verified in browser against real
// application — that's the R8.4d real-e2e checklist.

import { expect, test, type Page, type Route } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

function fakeBaseUrl(originUrl: string): string {
  return `${originUrl}/__fake-platform/app`;
}

async function originOf(page: Page): Promise<string> {
  return page.evaluate(() => window.location.origin);
}

interface MockEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

async function fulfillJson<T>(
  route: Route,
  status: number,
  envelope: MockEnvelope<T>,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(envelope),
  });
}

test.describe('PlatformProfileProvider update fields (R8.4d-1)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  // ────────────────────────── updateBio ──────────────────────────

  test('updateBio: success path with non-empty bio → posts trimmed bio', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let body: unknown = null;
    let method = '';
    await page.route(
      '**/__fake-platform/app/app/member/user/update-bio',
      async (route: Route) => {
        method = route.request().method();
        body = JSON.parse(route.request().postData() ?? 'null');
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateBio(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateBio(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      bio: '  Hello world  ',
    });

    expect(out).toEqual({ ok: true, data: null });
    expect(method).toBe('PUT');
    expect(body).toEqual({ bio: 'Hello world' });
  });

  test('updateBio: null (or empty after trim) sends null to clear', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let body: unknown = null;
    await page.route(
      '**/__fake-platform/app/app/member/user/update-bio',
      async (route: Route) => {
        body = JSON.parse(route.request().postData() ?? 'null');
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateBio(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateBio(args),
    { baseUrl, accessToken: 'access-jwt-test', bio: null });

    expect(body).toEqual({ bio: null });
  });

  test('updateBio: too long (>200 chars) → PlatformConfigError, NO HTTP', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let hits = 0;
    await page.route(
      '**/__fake-platform/app/app/member/user/update-bio',
      async (route: Route) => {
        hits += 1;
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateBio(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateBio(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      bio: 'x'.repeat(201),
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });
    expect(hits).toBe(0);
  });

  // ────────────────────────── updateGender ──────────────────────────

  test('updateGender: valid values 0/1/2/9 → success', async ({ page }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    const observed: number[] = [];
    await page.route(
      '**/__fake-platform/app/app/member/user/update-gender',
      async (route: Route) => {
        const body = JSON.parse(route.request().postData() ?? 'null') as {
          gender: number;
        };
        observed.push(body.gender);
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    for (const g of [0, 1, 2, 9]) {
      const out = await page.evaluate(async (args) =>
        (
          window as unknown as {
            __privchatTest: {
              platformUpdateGender(args: unknown): Promise<unknown>;
            };
          }
        ).__privchatTest.platformUpdateGender(args),
      { baseUrl, accessToken: 'access-jwt-test', gender: g });
      expect(out).toEqual({ ok: true, data: null });
    }
    expect(observed).toEqual([0, 1, 2, 9]);
  });

  test('updateGender: invalid value (e.g. 5) → PlatformConfigError, NO HTTP', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let hits = 0;
    await page.route(
      '**/__fake-platform/app/app/member/user/update-gender',
      async (route: Route) => {
        hits += 1;
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateGender(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateGender(args),
    { baseUrl, accessToken: 'access-jwt-test', gender: 5 });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });
    expect(hits).toBe(0);
  });

  // ────────────────────────── updateBirthday ──────────────────────────

  test('updateBirthday: ISO date → success', async ({ page }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let body: unknown = null;
    await page.route(
      '**/__fake-platform/app/app/member/user/update-birthday',
      async (route: Route) => {
        body = JSON.parse(route.request().postData() ?? 'null');
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateBirthday(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateBirthday(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      birthday: '1990-01-15',
    });

    expect(out).toEqual({ ok: true, data: null });
    expect(body).toEqual({ birthday: '1990-01-15' });
  });

  test('updateBirthday: null sends null to clear', async ({ page }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let body: unknown = null;
    await page.route(
      '**/__fake-platform/app/app/member/user/update-birthday',
      async (route: Route) => {
        body = JSON.parse(route.request().postData() ?? 'null');
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateBirthday(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateBirthday(args),
    { baseUrl, accessToken: 'access-jwt-test', birthday: null });

    expect(body).toEqual({ birthday: null });
  });

  test('updateBirthday: invalid format → PlatformConfigError, NO HTTP', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let hits = 0;
    await page.route(
      '**/__fake-platform/app/app/member/user/update-birthday',
      async (route: Route) => {
        hits += 1;
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateBirthday(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateBirthday(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      birthday: 'not-a-date',
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });
    expect(hits).toBe(0);
  });

  // ─────────────────────── error class mapping ───────────────────────

  test('updateBio: server error code !== 0 → PlatformApiError with message', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/app/member/user/update-bio',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          code: 4002,
          message: 'BIO_CONTAINS_FORBIDDEN_WORDS',
        });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateBio(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateBio(args),
    { baseUrl, accessToken: 'access-jwt-test', bio: 'hello' });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformApiError',
      errorCode: 4002,
      errorMessage: 'BIO_CONTAINS_FORBIDDEN_WORDS',
    });
  });
});
