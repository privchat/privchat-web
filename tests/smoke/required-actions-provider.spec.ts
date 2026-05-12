// R8.4b — RequiredActionsProvider + PlatformProfileProvider smokes.
//
// Each test mocks the specific endpoint(s) under `**/__fake-platform/app/**`
// and drives the provider via harness controls (the production factory is
// BUILTIN in test builds; we construct providers directly to keep the
// cached factory untouched).

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

test.describe('RequiredActionsProvider + PlatformProfileProvider (R8.4b)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('BuiltinRequiredActionsProvider always returns [] (no HTTP)', async ({
    page,
  }) => {
    let hits = 0;
    await page.route('**/account/required-actions', async (route: Route) => {
      hits += 1;
      await fulfillJson(route, 200, { code: 0, data: { requiredActions: [] } });
    });
    const out = await page.evaluate(async () =>
      (
        window as unknown as {
          __privchatTest: {
            builtinListRequiredActions(): Promise<unknown>;
          };
        }
      ).__privchatTest.builtinListRequiredActions(),
    );
    expect(out).toEqual({ ok: true, data: [] });
    expect(hits).toBe(0);
  });

  test('PlatformRequiredActionsProvider: server returns full action → parsed', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/account/required-actions',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          code: 0,
          data: {
            requiredActions: [
              {
                action: 'complete_profile',
                required: true,
                title: '设置昵称',
                titleKey: 'requiredAction.completeProfile.nickname',
                fields: ['nickname'],
              },
            ],
          },
        });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformListRequiredActions(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformListRequiredActions(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
    });

    expect(out).toEqual({
      ok: true,
      data: [
        {
          action: 'complete_profile',
          required: true,
          title: '设置昵称',
          titleKey: 'requiredAction.completeProfile.nickname',
          fields: ['nickname'],
        },
      ],
    });
  });

  test('PlatformRequiredActionsProvider: missing requiredActions field → []', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/account/required-actions',
      async (route: Route) => {
        // Simulate kotlinx encode-defaults behaviour: empty arrays omitted.
        await fulfillJson(route, 200, { code: 0, data: {} });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformListRequiredActions(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformListRequiredActions(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
    });

    expect(out).toEqual({ ok: true, data: [] });
  });

  test('PlatformRequiredActionsProvider: 401 → PlatformHttpError(401)', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/account/required-actions',
      async (route: Route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: '{"code":10000,"message":"Authentication required","data":null}',
        });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformListRequiredActions(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformListRequiredActions(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformHttpError',
      errorStatus: 401,
    });
  });

  test('PlatformProfileProvider.getProfile maps server fields → MemberProfile', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/app/member/user/get',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          code: 0,
          data: {
            id: 900_001,
            mobile: '+8615000000000',
            nickname: 'Member_0000',
            avatar: null,
            username: 'user_900001',
            usernameUpdatedAt: null,
            gender: 0,
            bio: null,
            birthday: null,
          },
        });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformGetProfile(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformGetProfile(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
    });

    expect(out).toMatchObject({
      ok: true,
      data: {
        // id widened to string at provider boundary
        id: '900001',
        mobile: '+8615000000000',
        nickname: 'Member_0000',
        username: 'user_900001',
        gender: 0,
      },
    });
  });

  test('PlatformProfileProvider.updateNickname: success path posts trimmed nickname', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let receivedBody: unknown = null;
    let receivedMethod = '';
    await page.route(
      '**/__fake-platform/app/app/member/user/update-nickname',
      async (route: Route) => {
        receivedMethod = route.request().method();
        receivedBody = JSON.parse(route.request().postData() ?? 'null');
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateNickname(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateNickname(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      nickname: '  Alice  ', // intentional whitespace
    });

    expect(out).toEqual({ ok: true, data: null });
    expect(receivedMethod).toBe('PUT');
    expect(receivedBody).toEqual({ nickname: 'Alice' });
  });

  test('PlatformProfileProvider.updateNickname: too short → PlatformConfigError, NO HTTP', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let hits = 0;
    await page.route(
      '**/__fake-platform/app/app/member/user/update-nickname',
      async (route: Route) => {
        hits += 1;
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateNickname(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateNickname(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      nickname: 'A', // 1 char after trim — server requires 2..32
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });
    expect(hits).toBe(0);
  });

  test('PlatformProfileProvider.updateNickname: server validation error → PlatformApiError', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/app/member/user/update-nickname',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          code: 4001,
          message: 'INVALID_NICKNAME_LENGTH',
        });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateNickname(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateNickname(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      nickname: 'Alice',
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformApiError',
      errorCode: 4001,
      errorMessage: 'INVALID_NICKNAME_LENGTH',
    });
  });

  test('RequiredAction decoding: missing required → true; titleKey fallback chain', async ({
    page,
  }) => {
    // Case 1: server-style full payload — required=true explicit, titleKey present
    const case1 = await page.evaluate(async (raw) =>
      (
        window as unknown as {
          __privchatTest: {
            decodeRequiredAction(raw: Record<string, unknown>): Promise<unknown>;
          };
        }
      ).__privchatTest.decodeRequiredAction(raw),
    {
      action: 'complete_profile',
      required: true,
      title: '设置昵称',
      titleKey: 'requiredAction.completeProfile.nickname',
      fields: ['nickname'],
    });
    expect(case1).toEqual({
      action: 'complete_profile',
      isRequired: true,
      // harness's t() is identity → titleKey "miss" → falls back to server `title`
      title: '设置昵称',
    });

    // Case 2: missing `required` field — wire-defense MUST treat as true
    const case2 = await page.evaluate(async (raw) =>
      (
        window as unknown as {
          __privchatTest: {
            decodeRequiredAction(raw: Record<string, unknown>): Promise<unknown>;
          };
        }
      ).__privchatTest.decodeRequiredAction(raw),
    {
      action: 'foo_bar',
      title: 'Some Action',
    });
    expect(case2).toEqual({
      action: 'foo_bar',
      isRequired: true,
      title: 'Some Action',
    });

    // Case 3: explicit required=false → silent-skippable
    const case3 = await page.evaluate(async (raw) =>
      (
        window as unknown as {
          __privchatTest: {
            decodeRequiredAction(raw: Record<string, unknown>): Promise<unknown>;
          };
        }
      ).__privchatTest.decodeRequiredAction(raw),
    {
      action: 'optional_thing',
      required: false,
    });
    expect(case3).toEqual({
      action: 'optional_thing',
      isRequired: false,
      // No title / titleKey → fallback to action machine name
      title: 'optional_thing',
    });
  });
});
