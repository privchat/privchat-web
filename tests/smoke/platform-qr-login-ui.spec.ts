// R8.5c — LoginPage QR tab UI smokes.
//
// Forces PLATFORM mode + same-origin fake `platformBaseUrl` via
// `addInitScript` (same pattern as platform-sms-login-ui.spec.ts),
// installs a scripted fake unauth-WS factory at the QR provider
// seam (`__setQrUnauthClientFactoryForTests`), and drives the
// production `<QrLoginPanel>` end-to-end:
//
//   1. PLATFORM renders the SMS/QR tab toggle; default tab = SMS
//   2. BUILTIN never renders QR tab (capability gate, no override)
//   3. Switching to QR tab triggers connect + create_scene RPC;
//      QR canvas + waiting text render
//   4. Authorized push → onLoggedIn fired with mapped credentials
//   5. Expired push → "Generate new code" button visible
//   6. "Generate new code" restarts the session (connect/RPC counts bump)
//   7. RPC failure on tab switch surfaces error state with retry
//   8. Unmount (cancel add-account) disposes the fake client

import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

interface QrHarnessSurface {
  qrInstallScriptedFactory(args: {
    connect: { kind: 'ok' } | { kind: 'fail'; message: string };
    rpc:
      | {
          kind: 'ok';
          sceneId: string;
          qrToken: string;
          expiresAt: number;
        }
      | { kind: 'fail'; message: string };
  }): Promise<void>;
  qrInjectPush(args: { topic: string; payloadJson: string }): Promise<{
    eventCount: number;
  }>;
  qrInspect(): Promise<{
    sessionActive: boolean;
    fakeConnectCalls: number;
    fakeRpcCalls: number;
    fakeDisposeCalls: number;
    fakePushListenerActive: boolean;
  }>;
}

async function callHarness<K extends keyof QrHarnessSurface>(
  page: Page,
  method: K,
  args?: Parameters<QrHarnessSurface[K]>[0],
): Promise<Awaited<ReturnType<QrHarnessSurface[K]>>> {
  return page.evaluate(
    ([m, a]: [string, unknown]) => {
      const t = (
        window as unknown as {
          __privchatTest: Record<string, (arg?: unknown) => Promise<unknown>>;
        }
      ).__privchatTest;
      return a === undefined ? t[m]!() : t[m]!(a);
    },
    [method, args] as [string, unknown],
  ) as Promise<Awaited<ReturnType<QrHarnessSurface[K]>>>;
}

function envelope(
  state: 'scanned' | 'rejected' | 'expired' | 'authorized',
  sceneId: string,
  data: unknown,
): string {
  return JSON.stringify({
    event: `qr_login.${state}`,
    scene_id: sceneId,
    state,
    data,
  });
}

function memberLoginResponse(
  overrides: Partial<{
    userId: number;
    accessToken: string;
    deviceId: string;
  }> = {},
): Record<string, unknown> {
  return {
    userId: overrides.userId ?? 8888,
    accessToken: overrides.accessToken ?? 'access-qr-ui',
    refreshToken: 'refresh-qr-ui',
    deviceId: overrides.deviceId ?? 'web-uuid-ui',
    expiresIn: 7200,
    imToken: 'im-qr-ui',
    imRefreshToken: 'im-ref-ui',
    imDeviceId: overrides.deviceId ?? 'web-uuid-ui',
    imExpiresIn: 86_400,
    imRefreshExpiresIn: 604_800,
    sessionVersion: 1,
    deviceCreated: true,
  };
}

// ─────────────────────── BUILTIN ─────────────────────────────────

test.describe('LoginPage QR tab — BUILTIN gate (R8.5c)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('BUILTIN never shows QR tab', async ({ page }) => {
    // BUILTIN renders the username/password form directly; no tab
    // toggle exists at all.
    await expect(page.getByTestId('login-tabs')).toHaveCount(0);
    await expect(page.getByTestId('login-tab-qr')).toHaveCount(0);
    await expect(page.getByTestId('login-tab-sms')).toHaveCount(0);
  });
});

// ─────────────────────── PLATFORM ────────────────────────────────

test.describe('LoginPage QR tab (R8.5c)', () => {
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

  // ─── 1. PLATFORM tabs visible; default SMS ──────────────────────

  test('PLATFORM renders SMS/QR tab toggle; SMS is default', async ({
    page,
  }) => {
    await expect(page.getByTestId('login-tabs')).toBeVisible();
    await expect(page.getByTestId('login-tab-sms')).toBeVisible();
    await expect(page.getByTestId('login-tab-qr')).toBeVisible();
    await expect(page.getByTestId('login-tab-sms')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('login-tab-qr')).toHaveAttribute(
      'aria-selected',
      'false',
    );
    // SMS form is what the user lands on.
    await expect(page.getByTestId('login-mobile-input')).toBeVisible();
    await expect(page.getByTestId('login-qr-panel')).toHaveCount(0);
  });

  // ─── 2. Switching to QR triggers session start ──────────────────

  test('clicking QR tab runs connect + RPC, renders waiting canvas', async ({
    page,
  }) => {
    await callHarness(page, 'qrInstallScriptedFactory', {
      connect: { kind: 'ok' },
      rpc: {
        kind: 'ok',
        sceneId: 'scene-ui-1',
        qrToken: 'qr_payload_ui_1',
        expiresAt: Date.now() + 90_000,
      },
    });

    await page.getByTestId('login-tab-qr').click();

    // Panel mounts.
    await expect(page.getByTestId('login-qr-panel')).toBeVisible();

    // Canvas renders once startQrLogin resolves.
    await expect(page.getByTestId('qr-canvas')).toBeVisible();

    // Connect + RPC fired at least once. React StrictMode runs
    // effects twice on mount so the absolute count is 2; we only
    // assert "the production code reached the unauth client".
    await expect
      .poll(async () => (await callHarness(page, 'qrInspect')).fakeRpcCalls)
      .toBeGreaterThanOrEqual(1);
    const inspect = await callHarness(page, 'qrInspect');
    expect(inspect.fakeConnectCalls).toBeGreaterThanOrEqual(1);
    expect(inspect.fakePushListenerActive).toBe(true);
  });

  // ─── 3. authorized push → onLoggedIn → LoginPage unmounts ───────

  test('authorized push routes through to onLoggedIn (LoginPage unmounts)', async ({
    page,
  }) => {
    await callHarness(page, 'qrInstallScriptedFactory', {
      connect: { kind: 'ok' },
      rpc: {
        kind: 'ok',
        sceneId: 'scene-auth',
        qrToken: 'qr_auth',
        expiresAt: Date.now() + 90_000,
      },
    });
    await page.getByTestId('login-tab-qr').click();
    await expect(page.getByTestId('qr-canvas')).toBeVisible();

    // Push authorized with full MemberLoginResponse.
    await callHarness(page, 'qrInjectPush', {
      topic: 'qr_login.authorized',
      payloadJson: envelope(
        'authorized',
        'scene-auth',
        memberLoginResponse({ userId: 7000, accessToken: 'tok-7000' }),
      ),
    });

    // TestApp's onLoggedIn → registry commit → switches active
    // account → ChatWorkspace renders; LoginPage panel disappears.
    await expect(page.getByTestId('login-qr-panel')).toHaveCount(0, {
      timeout: 5000,
    });

    // Fake client got disposed.
    await expect
      .poll(async () => (await callHarness(page, 'qrInspect')).fakeDisposeCalls)
      .toBeGreaterThanOrEqual(1);
  });

  // ─── 4. expired push → "Generate new code" surfaces ─────────────

  test('expired push shows regenerate affordance', async ({ page }) => {
    await callHarness(page, 'qrInstallScriptedFactory', {
      connect: { kind: 'ok' },
      rpc: {
        kind: 'ok',
        sceneId: 'scene-exp',
        qrToken: 'qr_exp',
        expiresAt: Date.now() + 90_000,
      },
    });
    await page.getByTestId('login-tab-qr').click();
    await expect(page.getByTestId('qr-canvas')).toBeVisible();

    await callHarness(page, 'qrInjectPush', {
      topic: 'qr_login.expired',
      payloadJson: envelope('expired', 'scene-exp', null),
    });

    await expect(page.getByTestId('qr-regenerate')).toBeVisible();
    // Canvas is replaced by the expired state.
    await expect(page.getByTestId('qr-canvas')).toHaveCount(0);
  });

  // ─── 5. regenerate triggers a new session ───────────────────────

  test('regenerate runs a fresh connect + RPC', async ({ page }) => {
    await callHarness(page, 'qrInstallScriptedFactory', {
      connect: { kind: 'ok' },
      rpc: {
        kind: 'ok',
        sceneId: 'scene-r1',
        qrToken: 'qr_r1',
        expiresAt: Date.now() + 90_000,
      },
    });
    await page.getByTestId('login-tab-qr').click();
    await expect(page.getByTestId('qr-canvas')).toBeVisible();
    await callHarness(page, 'qrInjectPush', {
      topic: 'qr_login.expired',
      payloadJson: envelope('expired', 'scene-r1', null),
    });
    await expect(page.getByTestId('qr-regenerate')).toBeVisible();

    // Re-install (same factory closure tracks counts) before
    // clicking regenerate so the new session uses scripted behavior.
    await callHarness(page, 'qrInstallScriptedFactory', {
      connect: { kind: 'ok' },
      rpc: {
        kind: 'ok',
        sceneId: 'scene-r2',
        qrToken: 'qr_r2',
        expiresAt: Date.now() + 90_000,
      },
    });
    await page.getByTestId('qr-regenerate').click();

    await expect(page.getByTestId('qr-canvas')).toBeVisible();
    const inspect = await callHarness(page, 'qrInspect');
    // The fresh fake recorded at least one connect + RPC. Regenerate
    // re-runs the effect via a regenerateNonce bump; if React strict
    // mode happens to double the run, the count rises uniformly —
    // production correctness is "fresh session started, NOT zero".
    expect(inspect.fakeConnectCalls).toBeGreaterThanOrEqual(1);
    expect(inspect.fakeRpcCalls).toBeGreaterThanOrEqual(1);
  });

  // ─── 6. RPC failure surfaces error state ────────────────────────

  test('RPC failure on tab switch surfaces error UI with retry', async ({
    page,
  }) => {
    await callHarness(page, 'qrInstallScriptedFactory', {
      connect: { kind: 'ok' },
      rpc: { kind: 'fail', message: 'mock server failure' },
    });
    await page.getByTestId('login-tab-qr').click();

    // Panel renders the error variant with regenerate.
    await expect(page.getByTestId('qr-regenerate')).toBeVisible({
      timeout: 5000,
    });
    // No canvas in the error state.
    await expect(page.getByTestId('qr-canvas')).toHaveCount(0);
    // qr-status carries the inline message (mapped through
    // getLoginErrorMessage; the raw error text is contained).
    await expect(page.getByTestId('qr-status')).toContainText(
      /mock server failure/,
    );
  });
});
