// R8.5b — `PlatformAuthProvider.startQrLogin` smokes.
//
// Unauth-WS QR login can't be tested with `page.route()` like the HTTP
// providers — the path is `Web → privchat-server` over an unauth
// WebSocket (PLATFORM_QR_LOGIN_CONTRACT §2). The harness exposes a
// scripted fake `QrUnauthClient` (see `__privchatTest.platformStartQr*`
// in mock-adapter.ts) that lets the spec drive every branch deterministically:
//
//   - happy create_scene → push topic dispatch → authorized event
//   - connect / RPC failures → rejected promise from `startQrLogin`
//   - cleanup: cancel(), terminal-event auto-dispose, idempotency
//   - capability gate: BUILTIN doesn't expose `startQrLogin`
//
// UI integration (LoginPage QR tab, QR canvas, countdown) is R8.5c.

import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

// `QrLoginEvent` mirrors `src/lib/platform-qr-login.ts`. Duplicated here
// because Playwright's `page.evaluate` boundary doesn't share runtime
// types with the app bundle — the harness returns a plain JSON shape
// and the spec asserts on it as data.
type QrLoginEvent =
  | { type: 'scanned'; sceneId: string }
  | { type: 'rejected'; sceneId: string; message?: string }
  | { type: 'expired'; sceneId: string }
  | {
      type: 'authorized';
      sceneId: string;
      result: {
        serverUrl: string;
        userId: string;
        accessToken: string;
        deviceId: string;
        accountMode: string;
        platformBaseUrl?: string;
        refreshToken?: string;
        requiredActions: Array<Record<string, unknown>>;
      };
    };

type ScriptedStart =
  | {
      ok: true;
      data: { sceneId: string; qrPayload: string; expiresInSeconds: number };
    }
  | {
      ok: false;
      errorName: string;
      errorMessage: string;
    };

interface HarnessSurface {
  describeAuthProvider(): Promise<{
    mode: string;
    hasStartQrLogin: boolean;
  }>;
  platformProviderHasStartQrLogin(): Promise<{ methodType: string }>;
  platformStartQrLoginScripted(args: {
    serverUrl: string;
    platformBaseUrl: string;
    deviceId: string;
    connect: { kind: 'ok' } | { kind: 'fail'; message: string };
    rpc:
      | {
          kind: 'ok';
          sceneId: string;
          qrToken: string;
          expiresAt: number;
          rpcTopic?: string;
        }
      | { kind: 'fail'; message: string };
  }): Promise<ScriptedStart>;
  qrInjectPush(args: { topic: string; payloadJson: string }): Promise<{
    eventCount: number;
  }>;
  qrDrainEvents(): Promise<QrLoginEvent[]>;
  qrCancel(): Promise<void>;
  qrInspect(): Promise<{
    sessionActive: boolean;
    fakeConnectCalls: number;
    fakeRpcCalls: number;
    fakeDisposeCalls: number;
    fakePushListenerActive: boolean;
  }>;
}

function harness(page: Page): {
  invoke: <K extends keyof HarnessSurface>(
    method: K,
    args?: Parameters<HarnessSurface[K]>[0],
  ) => Promise<Awaited<ReturnType<HarnessSurface[K]>>>;
} {
  return {
    async invoke(method, args) {
      return page.evaluate(
        ([m, a]: [string, unknown]) => {
          const t = (
            window as unknown as {
              __privchatTest: Record<
                string,
                (arg?: unknown) => Promise<unknown>
              >;
            }
          ).__privchatTest;
          // The harness methods are `async` thunks; some take no args.
          return a === undefined ? t[m]!() : t[m]!(a);
        },
        [method, args] as [string, unknown],
      ) as Promise<Awaited<ReturnType<HarnessSurface[typeof method]>>>;
    },
  };
}

// In the test build `getAuthProvider()` returns the BUILTIN provider
// (the cache is set on first call), so to exercise the PLATFORM-side
// `startQrLogin` we go through `platformStartQrLoginScripted` which
// constructs a `PlatformAuthProvider` ad-hoc (same pattern R8.4
// profile smokes use).

// Canonical scene used by most happy-path tests. `expiresAt` is set
// 90s in the future so `expiresInSeconds` is positive on assertion.
function makeSceneScript(overrides: Partial<{
  sceneId: string;
  qrToken: string;
  ttlMs: number;
}> = {}): {
  kind: 'ok';
  sceneId: string;
  qrToken: string;
  expiresAt: number;
} {
  const sceneId = overrides.sceneId ?? 'scene-abc-123';
  const qrToken = overrides.qrToken ?? 'qr_payload_signed_xyz';
  const ttlMs = overrides.ttlMs ?? 90_000;
  return {
    kind: 'ok',
    sceneId,
    qrToken,
    expiresAt: Date.now() + ttlMs,
  };
}

const SERVER_URL = 'ws://example.test/im';
const PLATFORM_BASE_URL = 'https://app.example.test/app';
const DEVICE_ID = '11111111-2222-3333-4444-555555555555';

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

// Reference `MemberLoginResponse` (R8.4a-server) used as the `data`
// field of `qr_login.authorized` per QR_LOGIN_CONTRACT §6.
function memberLoginResponse(
  overrides: Partial<{
    userId: number;
    accessToken: string;
    refreshToken: string;
    deviceId: string;
    requiredActions: Array<Record<string, unknown>>;
  }> = {},
): Record<string, unknown> {
  return {
    userId: overrides.userId ?? 4242,
    accessToken: overrides.accessToken ?? 'access-jwt-qr',
    refreshToken: overrides.refreshToken ?? 'refresh-jwt-qr',
    deviceId: overrides.deviceId ?? 'web-uuid-001',
    expiresIn: 7200,
    imToken: 'im-token-qr',
    imRefreshToken: 'im-refresh-qr',
    imDeviceId: 'web-uuid-001',
    imExpiresIn: 86_400,
    imRefreshExpiresIn: 604_800,
    sessionVersion: 1,
    deviceCreated: true,
    ...(overrides.requiredActions === undefined
      ? {}
      : { requiredActions: overrides.requiredActions }),
  };
}

test.describe('PlatformAuthProvider.startQrLogin (R8.5b)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  // ─── 1. capability gate (BUILTIN absent) ──────────────────────────

  test('BUILTIN provider does not expose startQrLogin', async ({ page }) => {
    // The test build defaults to BUILTIN mode (vite test env). The
    // factory caches once on first call, so describe sees BUILTIN.
    const desc = await harness(page).invoke('describeAuthProvider');
    expect(desc.mode).toBe('builtin');
    expect(desc.hasStartQrLogin).toBe(false);
  });

  // ─── 2. capability gate (PLATFORM present) ────────────────────────

  test('PlatformAuthProvider has startQrLogin method', async ({ page }) => {
    // Constructs `new PlatformAuthProvider(...)` directly (separate
    // from the BUILTIN runtime cache) and asserts the method is
    // installed on the prototype.
    const probe = await harness(page).invoke(
      'platformProviderHasStartQrLogin',
    );
    expect(probe.methodType).toBe('function');
  });

  // ─── 3. startQrLogin calls qr_login/create_scene ──────────────────

  test('happy start: connect + rpcCallTyped invoked exactly once each', async ({
    page,
  }) => {
    const h = harness(page);
    const result = await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript(),
    });
    expect(result.ok).toBe(true);

    const inspect = await h.invoke('qrInspect');
    expect(inspect.sessionActive).toBe(true);
    expect(inspect.fakeConnectCalls).toBe(1);
    expect(inspect.fakeRpcCalls).toBe(1);
    expect(inspect.fakeDisposeCalls).toBe(0);
    expect(inspect.fakePushListenerActive).toBe(true);
  });

  // ─── 4. scene response mapping ────────────────────────────────────

  test('scene response maps sceneId / qrPayload / expiresInSeconds', async ({
    page,
  }) => {
    const result = await harness(page).invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript({
        sceneId: 'scene-xyz',
        qrToken: 'qr_token_opaque',
        ttlMs: 60_000,
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.sceneId).toBe('scene-xyz');
    // R8.6 wire-fix: payload is now a JSON envelope `{sceneId, qrToken}`
    // so the App-side scanner can recover both fields. Verify by
    // round-tripping through JSON.parse rather than string equality.
    const decoded = JSON.parse(result.data.qrPayload) as {
      sceneId: string;
      qrToken: string;
    };
    expect(decoded).toEqual({ sceneId: 'scene-xyz', qrToken: 'qr_token_opaque' });
    // Round to nearest second; allow ±2 to account for test timing
    // overhead between makeSceneScript() and provider's Date.now().
    expect(result.data.expiresInSeconds).toBeGreaterThanOrEqual(58);
    expect(result.data.expiresInSeconds).toBeLessThanOrEqual(60);
  });

  // ─── 5. scanned push → scanned event ──────────────────────────────

  test('scanned push emits scanned event', async ({ page }) => {
    const h = harness(page);
    const start = await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript({ sceneId: 'scene-s' }),
    });
    expect(start.ok).toBe(true);

    await h.invoke('qrInjectPush', {
      topic: 'qr_login.scanned',
      payloadJson: envelope('scanned', 'scene-s', {
        scanner_uid: 1234567890,
        scanner_avatar: 'https://cdn/avatar.png',
        scanner_display_name: 'Alice',
        scanned_at: Date.now(),
      }),
    });

    const events = await h.invoke('qrDrainEvents');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'scanned', sceneId: 'scene-s' });

    // Not terminal — listener still active.
    const inspect = await h.invoke('qrInspect');
    expect(inspect.fakePushListenerActive).toBe(true);
    expect(inspect.fakeDisposeCalls).toBe(0);
  });

  // ─── 6. rejected push → rejected event + auto cleanup ─────────────

  test('rejected push emits rejected event and disposes', async ({ page }) => {
    const h = harness(page);
    await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript({ sceneId: 'scene-r' }),
    });
    await h.invoke('qrInjectPush', {
      topic: 'qr_login.rejected',
      payloadJson: envelope('rejected', 'scene-r', null),
    });

    const events = await h.invoke('qrDrainEvents');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'rejected', sceneId: 'scene-r' });

    const inspect = await h.invoke('qrInspect');
    expect(inspect.fakeDisposeCalls).toBe(1);
    expect(inspect.fakePushListenerActive).toBe(false);
  });

  // ─── 7. expired push → expired event + auto cleanup ───────────────

  test('expired push emits expired event and disposes', async ({ page }) => {
    const h = harness(page);
    await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript({ sceneId: 'scene-e' }),
    });
    await h.invoke('qrInjectPush', {
      topic: 'qr_login.expired',
      payloadJson: envelope('expired', 'scene-e', null),
    });

    const events = await h.invoke('qrDrainEvents');
    expect(events).toEqual([{ type: 'expired', sceneId: 'scene-e' }]);

    const inspect = await h.invoke('qrInspect');
    expect(inspect.fakeDisposeCalls).toBe(1);
    expect(inspect.fakePushListenerActive).toBe(false);
  });

  // ─── 8. authorized push → MemberLoginResponse mapped to LoginResult ─

  test('authorized push maps MemberLoginResponse → LoginResult', async ({
    page,
  }) => {
    const h = harness(page);
    await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript({ sceneId: 'scene-a' }),
    });
    await h.invoke('qrInjectPush', {
      topic: 'qr_login.authorized',
      payloadJson: envelope(
        'authorized',
        'scene-a',
        memberLoginResponse({
          userId: 7777,
          accessToken: 'access-7777',
          refreshToken: 'refresh-7777',
          deviceId: 'dev-7777',
          requiredActions: [
            { action: 'complete_profile', required: true, titleKey: 'k' },
          ],
        }),
      ),
    });

    const events = await h.invoke('qrDrainEvents');
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe('authorized');
    if (ev.type !== 'authorized') throw new Error('unreachable');
    expect(ev.sceneId).toBe('scene-a');
    expect(ev.result).toMatchObject({
      serverUrl: SERVER_URL,
      userId: '7777',
      accessToken: 'access-7777',
      refreshToken: 'refresh-7777',
      deviceId: 'dev-7777',
      accountMode: 'platform',
      platformBaseUrl: PLATFORM_BASE_URL,
    });
    expect(ev.result.requiredActions).toEqual([
      { action: 'complete_profile', required: true, titleKey: 'k' },
    ]);

    // Terminal — cleaned up.
    const inspect = await h.invoke('qrInspect');
    expect(inspect.fakeDisposeCalls).toBe(1);
    expect(inspect.fakePushListenerActive).toBe(false);
  });

  // ─── 8b. requiredActions field omitted → defaults to [] ────────────

  test('authorized without requiredActions field → result.requiredActions === []', async ({
    page,
  }) => {
    const h = harness(page);
    await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript({ sceneId: 'scene-a2' }),
    });
    await h.invoke('qrInjectPush', {
      topic: 'qr_login.authorized',
      payloadJson: envelope(
        'authorized',
        'scene-a2',
        memberLoginResponse(), // no requiredActions key
      ),
    });

    const events = await h.invoke('qrDrainEvents');
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    if (ev.type !== 'authorized') throw new Error('unreachable');
    expect(ev.result.requiredActions).toEqual([]);
  });

  // ─── 9. sceneId filter: foreign push is ignored ───────────────────

  test('push for a different sceneId is ignored', async ({ page }) => {
    const h = harness(page);
    await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript({ sceneId: 'scene-mine' }),
    });
    await h.invoke('qrInjectPush', {
      topic: 'qr_login.scanned',
      payloadJson: envelope('scanned', 'scene-OTHER', {
        scanner_uid: 1,
        scanned_at: 0,
      }),
    });

    const events = await h.invoke('qrDrainEvents');
    expect(events).toHaveLength(0);

    const inspect = await h.invoke('qrInspect');
    expect(inspect.fakePushListenerActive).toBe(true);
    expect(inspect.fakeDisposeCalls).toBe(0);
  });

  // ─── 10. cancel disposes listener + client ────────────────────────

  test('cancel() unsubscribes push listener and disposes client', async ({
    page,
  }) => {
    const h = harness(page);
    await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript(),
    });
    await h.invoke('qrCancel');

    const inspect = await h.invoke('qrInspect');
    expect(inspect.fakePushListenerActive).toBe(false);
    expect(inspect.fakeDisposeCalls).toBe(1);

    // Late push after cancel must not surface as an event.
    await h.invoke('qrInjectPush', {
      topic: 'qr_login.scanned',
      payloadJson: envelope('scanned', 'scene-abc-123', {
        scanner_uid: 1,
      }),
    });
    const events = await h.invoke('qrDrainEvents');
    expect(events).toHaveLength(0);
  });

  // ─── 11. double cancel is safe (idempotent) ───────────────────────

  test('cancel() is idempotent: second call is a no-op', async ({ page }) => {
    const h = harness(page);
    await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript(),
    });
    await h.invoke('qrCancel');
    await h.invoke('qrCancel'); // must not throw
    await h.invoke('qrCancel'); // really must not throw
    const inspect = await h.invoke('qrInspect');
    // dispose was only really called once; subsequent cancels short-circuit.
    expect(inspect.fakeDisposeCalls).toBe(1);
  });

  // ─── 12. connect failure → rejected promise, no session ───────────

  test('connect() rejection surfaces as PlatformInvokeResult error', async ({
    page,
  }) => {
    const result = await harness(page).invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'fail', message: 'transport refused' },
      rpc: makeSceneScript(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errorMessage).toContain('transport refused');

    const inspect = await harness(page).invoke('qrInspect');
    expect(inspect.sessionActive).toBe(false);
    expect(inspect.fakeConnectCalls).toBe(1);
    expect(inspect.fakeRpcCalls).toBe(0);
    // We must still dispose() even after connect failure to release
    // any half-open socket.
    expect(inspect.fakeDisposeCalls).toBe(1);
    expect(inspect.fakePushListenerActive).toBe(false);
  });

  // ─── 13. RPC failure → rejected promise, dispose called ───────────
  //
  // (Bonus: the user-spec lists 12 cases as the floor. This is an
  // explicit RPC-fail variant; case 12 only covers connect failure.)

  test('create_scene RPC rejection surfaces as PlatformInvokeResult error', async ({
    page,
  }) => {
    const result = await harness(page).invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: { kind: 'fail', message: 'server 500' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errorMessage).toContain('server 500');

    const inspect = await harness(page).invoke('qrInspect');
    expect(inspect.sessionActive).toBe(false);
    expect(inspect.fakeConnectCalls).toBe(1);
    expect(inspect.fakeRpcCalls).toBe(1);
    expect(inspect.fakeDisposeCalls).toBe(1);
    expect(inspect.fakePushListenerActive).toBe(false);
  });

  // ─── 14. malformed authorized payload → silent expire ─────────────
  //
  // Per QR_LOGIN_CONTRACT §10: protocol errors in `authorized.data`
  // surface as an `expired` event (no token = no login; UI shows
  // expired + re-issue). No `error` variant in the 4-event union.

  test('authorized push with malformed data → expired event', async ({
    page,
  }) => {
    const h = harness(page);
    await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript({ sceneId: 'scene-bad' }),
    });
    await h.invoke('qrInjectPush', {
      topic: 'qr_login.authorized',
      payloadJson: envelope('authorized', 'scene-bad', {
        // missing accessToken, refreshToken, deviceId
        userId: 1,
      }),
    });

    const events = await h.invoke('qrDrainEvents');
    expect(events).toEqual([{ type: 'expired', sceneId: 'scene-bad' }]);
    const inspect = await h.invoke('qrInspect');
    expect(inspect.fakeDisposeCalls).toBe(1);
    expect(inspect.fakePushListenerActive).toBe(false);
  });

  // ─── 15. non-qr_login.* topic is ignored ──────────────────────────

  test('push with non-qr_login topic is ignored', async ({ page }) => {
    const h = harness(page);
    await h.invoke('platformStartQrLoginScripted', {
      serverUrl: SERVER_URL,
      platformBaseUrl: PLATFORM_BASE_URL,
      deviceId: DEVICE_ID,
      connect: { kind: 'ok' },
      rpc: makeSceneScript(),
    });
    await h.invoke('qrInjectPush', {
      topic: 'typing',
      payloadJson: '{"foo":"bar"}',
    });
    const events = await h.invoke('qrDrainEvents');
    expect(events).toHaveLength(0);
    const inspect = await h.invoke('qrInspect');
    expect(inspect.fakePushListenerActive).toBe(true);
  });
});
