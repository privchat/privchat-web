// Workspace HTTP auth-refresh recovery: the access token expires after
// its 1h TTL, and the SDK-driven refresh only fires on SDK RPC failures.
// These specs prove `WorkspaceApi` itself refreshes once (single-flight)
// and retries the SAME request with the new token, so the device-nodes
// and workspace-home pages recover instead of staying permanently 401.
//
// HTTP is intercepted with `page.route()` against a same-origin synthetic
// baseUrl (no CORS preflight, no real network). The harness hook forces
// PLATFORM mode, seeds a platform session, resets the cached provider and
// runs the real `WorkspaceApi.get` → `refreshActivePlatformToken` path.

import { expect, test, type Page, type Route } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

function fakeBaseUrl(originUrl: string): string {
  return `${originUrl}/__fake-platform/app`;
}

async function fulfillJson(
  route: Route,
  status: number,
  envelope: unknown,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(envelope),
  });
}

async function originOf(page: Page): Promise<string> {
  return page.evaluate(() => window.location.origin);
}

interface RetryArgs {
  baseUrl: string;
  url: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  path: string;
}

function invoke(page: Page, args: RetryArgs): Promise<unknown> {
  return page.evaluate(
    async (a) =>
      (
        window as unknown as {
          __privchatTest: {
            workspaceAuthRefreshRetry(args: RetryArgs): Promise<unknown>;
          };
        }
      ).__privchatTest.workspaceAuthRefreshRetry(a),
    args,
  );
}

const SESSION = {
  url: 'ws://gw.example/',
  userId: '900001',
  deviceId: 'dev-local',
  accessToken: 'access-old',
  refreshToken: 'refresh-old',
  path: '/agent/nodes',
};

test.describe('WorkspaceApi auth-refresh recovery', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('expired access token → one refresh → retry with the new token recovers', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    const nodeAuthHeaders: string[] = [];
    let refreshCalls = 0;
    let refreshBody: unknown = null;

    await page.route('**/__fake-platform/app/agent/nodes', async (route) => {
      nodeAuthHeaders.push(route.request().headers()['authorization'] ?? '');
      if (nodeAuthHeaders.length === 1) {
        await fulfillJson(route, 401, {
          code: 10000,
          message: 'AUTH_REQUIRED',
          data: null,
        });
      } else {
        await fulfillJson(route, 200, {
          code: 0,
          data: [{ nodeId: 'n1', name: 'Node 1', state: 'online', granted: [] }],
        });
      }
    });
    await page.route('**/__fake-platform/app/auth/refresh-token', async (route) => {
      refreshCalls += 1;
      refreshBody = JSON.parse(route.request().postData() ?? 'null');
      await fulfillJson(route, 200, {
        code: 0,
        data: {
          userId: 900001,
          accessToken: 'access-new',
          refreshToken: 'refresh-rotated',
          deviceId: 'dev-local',
        },
      });
    });

    const out = (await invoke(page, { baseUrl, ...SESSION })) as {
      ok: boolean;
      data?: unknown;
    };

    expect(out.ok).toBe(true);
    expect(out.data).toEqual([
      { nodeId: 'n1', name: 'Node 1', state: 'online', granted: [] },
    ]);
    // Exactly one refresh, carrying the stored refresh token + device.
    expect(refreshCalls).toBe(1);
    expect(refreshBody).toEqual({
      refreshToken: 'refresh-old',
      deviceId: 'dev-local',
    });
    // First attempt used the old token; the retry used the rotated one.
    expect(nodeAuthHeaders).toEqual(['Bearer access-old', 'Bearer access-new']);
  });

  test('a non-auth business error is surfaced as-is, never refreshed or retried', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let nodeCalls = 0;
    let refreshCalls = 0;

    await page.route('**/__fake-platform/app/agent/nodes', async (route) => {
      nodeCalls += 1;
      await fulfillJson(route, 200, { code: 10200, message: 'CONFLICT' });
    });
    await page.route('**/__fake-platform/app/auth/refresh-token', async (route) => {
      refreshCalls += 1;
      await fulfillJson(route, 200, {
        code: 0,
        data: {
          userId: 900001,
          accessToken: 'access-new',
          refreshToken: 'r',
          deviceId: 'dev-local',
        },
      });
    });

    const out = (await invoke(page, { baseUrl, ...SESSION })) as {
      ok: boolean;
      errorName?: string;
      errorCode?: number;
    };

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformApiError',
      errorCode: 10200,
    });
    expect(nodeCalls).toBe(1);
    expect(refreshCalls).toBe(0);
  });

  test('a terminal refresh failure surfaces the original auth error (no retry loop)', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let nodeCalls = 0;
    let refreshCalls = 0;

    await page.route('**/__fake-platform/app/agent/nodes', async (route) => {
      nodeCalls += 1;
      await fulfillJson(route, 401, {
        code: 10000,
        message: 'AUTH_REQUIRED',
        data: null,
      });
    });
    await page.route('**/__fake-platform/app/auth/refresh-token', async (route) => {
      refreshCalls += 1;
      await fulfillJson(route, 200, {
        code: 10001,
        message: 'INVALID_REFRESH_TOKEN',
      });
    });

    const out = (await invoke(page, { baseUrl, ...SESSION })) as {
      ok: boolean;
      errorName?: string;
      errorCode?: number;
    };

    // The original 10000 (not the refresh's 10001) reaches the caller.
    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformApiError',
      errorCode: 10000,
    });
    expect(nodeCalls).toBe(1);
    expect(refreshCalls).toBe(1);
  });
});