// R8.5b — Platform QR login (Web side) — unauth WS RPC client.
//
// `PLATFORM_QR_LOGIN_CONTRACT` §2/§5. Web申请扫码 / 监听 push全部走
// privchat-server 的 unauth WebSocket（SDK 既有能力，零改动）；application
// 不参与扫码 in-flight 阶段。本文件实现 provider 一侧的扫码会话生命周期：
//
//   ① 建临时 PrivchatClient (unauth) → connect() → rpcCallTyped(
//      'qr_login/create_scene', body)
//   ② 用返回的 sceneId 挂 onPushMessage 监听，按 topic === 'qr_login.*'
//      过滤；payload UTF-8 反 JSON 得 spec QR_API §5.2 信封；按
//      scene_id 过滤掉其他 session 的 push
//   ③ 终态事件（authorized/rejected/expired）派发 → 自动 dispose
//   ④ cancel() 任意时刻幂等：unsubscribe + dispose
//
// `authorized.data` = 完整 MemberLoginResponse（R8.4a-server 统一 token）。
// 映射成 `LoginResult` 时和 `PlatformAuthProvider.loginWithSms` 走同一条
// 规则：requiredActions ?? [] 守则、platformBaseUrl 从入参带回、refresh
// token 透传。`onLoggedIn` 路径上下游因此对 SMS / QR 两个来源不可见。
//
// 注入点：`startPlatformQrLoginWithClient(input, factory)` 把"如何造
// unauth client"抽到第二参数。生产使用 `defaultQrUnauthClientFactory`
// 包装 PrivchatClient；harness 注入脚本化的 fake client 让 smoke 可以
// 在不连真 server 的情况下完整跑完所有事件路径。

import type { PrivchatClient, PushMessageRequest } from '@privchat/sdk';
import { PrivchatClient as PrivchatClientCtor } from '@privchat/sdk';
import type { DeviceInfo, LoginResult } from './account-auth-provider';
import { normalizePlatformBaseUrl } from './platform-base-url';
import { PlatformConfigError, PlatformProtocolError } from './platform-errors';
import type { RequiredAction } from './required-action';

// ─────────────────── Public types ───────────────────

export interface QrLoginInput {
  /** WebSocket URL of privchat-server. Passed through to `LoginResult.serverUrl`
   *  on `authorized`. Same value BUILTIN login uses. */
  serverUrl: string;
  /** Application HTTP base URL (e.g. `https://app.example.com/app`). Provider
   *  never contacts it during the scan flow — it's threaded into the returned
   *  `LoginResult.platformBaseUrl` so `onLoggedIn` can persist it. */
  platformBaseUrl: string;
  device: DeviceInfo;
}

export interface QrLoginScene {
  sceneId: string;
  /** Raw `qr_token` payload from server. UI renders it inside a QR canvas
   *  verbatim; do NOT re-wrap with scene_id or anything else (App scanner
   *  only inspects this opaque token). */
  qrPayload: string;
  /** Server-reported TTL converted to seconds-remaining at session start.
   *  UI uses it to drive the visible countdown. */
  expiresInSeconds: number;
}

export type QrLoginEvent =
  | { type: 'scanned'; sceneId: string }
  | { type: 'rejected'; sceneId: string; message?: string }
  | { type: 'expired'; sceneId: string }
  | { type: 'authorized'; sceneId: string; result: LoginResult };

export interface QrLoginSession {
  scene: QrLoginScene;
  /** Subscribe to lifecycle events. Returned function unsubscribes. After
   *  a terminal event (authorized/rejected/expired) the session auto-cleans
   *  up — late subscribers will see no further events. */
  subscribe(listener: (event: QrLoginEvent) => void): () => void;
  /** Cancel the in-flight session. Idempotent. After cancel, no further
   *  events fire and the underlying WS is disposed. Safe to call after a
   *  terminal event (no-op). */
  cancel(): Promise<void>;
}

// ─────────────────── SDK seam ───────────────────

/** Minimal surface this module needs from a PrivchatClient. Pulled out
 *  as an interface so the harness can pass a scripted fake without the
 *  rest of the SDK construction. */
export interface QrUnauthClient {
  connect(): Promise<void>;
  rpcCallTyped<Req, Resp>(route: string, body: Req): Promise<Resp>;
  /** Returns an unsubscribe function. */
  onPushMessage(cb: (msg: PushMessageRequest) => void): () => void;
  dispose(): Promise<void>;
}

export type QrUnauthClientFactory = (url: string) => QrUnauthClient;

/** Production factory: wraps a real `PrivchatClient` so the QR session
 *  treats it through the narrow `QrUnauthClient` interface. */
export const defaultQrUnauthClientFactory: QrUnauthClientFactory = (url) => {
  const client: PrivchatClient = new PrivchatClientCtor({ url });
  return {
    connect: () => client.connect(),
    rpcCallTyped: (route, body) => client.rpcCallTyped(route, body),
    onPushMessage: (cb) => client.onPushMessage(cb),
    dispose: () => client.dispose(),
  };
};

/** Test-only seam. When non-null, `PlatformAuthProvider.startQrLogin`
 *  (and any other production caller of `getActiveQrUnauthClientFactory`)
 *  uses this factory instead of `defaultQrUnauthClientFactory`. Set
 *  via the test harness; production code MUST NOT touch this. */
let qrUnauthClientFactoryOverride: QrUnauthClientFactory | null = null;

/** Test-only setter. Reset to `null` between specs (the harness's
 *  `reset()` does this). */
export function __setQrUnauthClientFactoryForTests(
  factory: QrUnauthClientFactory | null,
): void {
  qrUnauthClientFactoryOverride = factory;
}

/** Resolve the active factory. Production = default; tests with
 *  the harness override installed = scripted fake. */
export function getActiveQrUnauthClientFactory(): QrUnauthClientFactory {
  return qrUnauthClientFactoryOverride ?? defaultQrUnauthClientFactory;
}

// ─────────────────── Wire shapes ───────────────────

/** RPC body for `qr_login/create_scene` (spec QR_API §5.1). */
interface CreateSceneRequest {
  purpose: 'login';
  web_device_id: string;
  web_device_info: {
    device_id: string;
    device_type: string;
    app_id: string;
    device_name: string;
    os_version?: string;
  };
  ttl_secs: number;
}

interface CreateSceneResponse {
  scene_id: string;
  qr_token: string;
  /** ms-resolution unix timestamp. */
  expires_at: number;
  /** Diagnostic / forward-compat only; SDK never subscribes by topic. */
  rpc_topic?: string;
}

/** Push event envelope (spec QR_API §5.2): `payload` field is UTF-8 JSON
 *  of this shape. */
interface PushEnvelope {
  event: string;
  scene_id: string;
  state: 'scanned' | 'rejected' | 'expired' | 'authorized';
  data: unknown;
}

/** Subset of `MemberLoginResponse` that drives the `LoginResult` map.
 *  Server (post R8.4a-server) ships top-level `deviceId`; we also fall
 *  back to `imDeviceId` for backward compatibility with the older
 *  QR_LOGIN_SPEC §5.5 shape, where only `imDeviceId` was named. */
interface AuthorizedData {
  userId: number;
  accessToken: string;
  refreshToken: string;
  deviceId?: string;
  imDeviceId?: string;
  requiredActions?: RequiredAction[];
}

// ─────────────────── Implementation ───────────────────

const DEFAULT_TTL_SECONDS = 90;
const QR_TOPIC_PREFIX = 'qr_login.';
const CREATE_SCENE_ROUTE = 'qr_login/create_scene';

/** Test-only entry point. Production callers use
 *  `PlatformAuthProvider.startQrLogin()` which threads
 *  `defaultQrUnauthClientFactory` here. */
export async function startPlatformQrLoginWithClient(
  input: QrLoginInput,
  factory: QrUnauthClientFactory,
): Promise<QrLoginSession> {
  if (input.device.device_id.trim() === '') {
    // No device_id = caller never primed the localStorage UUID. Fail
    // closed (no RPC) — server would just refuse with a less helpful
    // error.
    throw new PlatformConfigError(
      'startQrLogin: device.device_id is required',
    );
  }
  const platformBaseUrl = normalizePlatformBaseUrl(input.platformBaseUrl);
  const client = factory(input.serverUrl);

  // Step 1: connect + RPC. If either fails, dispose and rethrow — no
  // session object handed back. Callers see a rejected Promise from
  // `startQrLogin`, no need for an event-based 'error' variant.
  let resp: CreateSceneResponse;
  try {
    await client.connect();
    const body: CreateSceneRequest = {
      purpose: 'login',
      web_device_id: input.device.device_id,
      web_device_info: {
        device_id: input.device.device_id,
        device_type: input.device.device_type,
        app_id: input.device.app_id,
        device_name: input.device.device_name,
        ...(input.device.os_version === undefined
          ? {}
          : { os_version: input.device.os_version }),
      },
      ttl_secs: DEFAULT_TTL_SECONDS,
    };
    resp = await client.rpcCallTyped<CreateSceneRequest, CreateSceneResponse>(
      CREATE_SCENE_ROUTE,
      body,
    );
  } catch (err) {
    // dispose() failure is swallowed — primary error is the connect/RPC one.
    await client.dispose().catch(() => {});
    throw err;
  }

  const sceneId = resp.scene_id;
  // R8.6 wire-fix: App-side scanner needs BOTH sceneId AND qr_token to
  // call `/platform/qr-login/scan` (spec QR_API §4.3 request shape requires
  // both). Earlier R8.5b had the canvas hold raw qr_token only — that left
  // App unable to recover sceneId. Encode as JSON envelope so the App
  // scanner can `JSON.parse` and pull both fields out.
  const qrPayload = JSON.stringify({
    sceneId,
    qrToken: resp.qr_token,
  });
  const now = Date.now();
  const expiresInSeconds = Math.max(
    0,
    Math.round((resp.expires_at - now) / 1000),
  );
  const scene: QrLoginScene = { sceneId, qrPayload, expiresInSeconds };

  // Step 2: install push listener BEFORE returning the session object.
  // Listener fires from the SDK bus; we fan out to user-registered
  // listeners via a Set. Multi-subscribe is cheap and lets the UI layer
  // attach multiple observers (e.g. logger + state-machine reducer).
  const listeners = new Set<(event: QrLoginEvent) => void>();
  let disposed = false;
  let unsubPush: (() => void) | null = null;

  // Forward-decl so `onPush` can call cleanup on terminal events.
  const cleanup = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    // Drop the SDK listener first so any racing push doesn't re-enter.
    if (unsubPush !== null) {
      unsubPush();
      unsubPush = null;
    }
    listeners.clear();
    await client.dispose().catch(() => {});
  };

  const emit = (event: QrLoginEvent): void => {
    // Snapshot listeners — handlers that throw or unsubscribe mid-fire
    // mustn't disturb the others. Error containment matches SDK L1 bus
    // (`SDK_EVENT_SURFACE_AND_API_SHAPE_SPEC §2.1`).
    const snapshot = Array.from(listeners);
    for (const l of snapshot) {
      try {
        l(event);
      } catch {
        // intentionally swallowed; provider stays alive
      }
    }
  };

  const onPush = (msg: PushMessageRequest): void => {
    if (disposed) return;
    if (!msg.topic.startsWith(QR_TOPIC_PREFIX)) return;
    // Decode UTF-8 JSON envelope. Malformed → ignore the push entirely;
    // no event surfaces to the UI. Pre-R8.5b we considered an 'error'
    // event variant — dropped per user spec (4-event union).
    let env: PushEnvelope;
    try {
      const text = new TextDecoder('utf-8').decode(msg.payload);
      env = JSON.parse(text) as PushEnvelope;
    } catch {
      return;
    }
    // Scene filter: an unauth WS can receive pushes for sessions we
    // didn't create (sceneId binding is per-connection on server, but
    // be defensive against future fan-out modes / test isolation bugs).
    if (typeof env.scene_id !== 'string' || env.scene_id !== sceneId) return;

    // Topic is authoritative — `state` field is for UI/logging only.
    const topic = msg.topic;
    if (topic === 'qr_login.scanned') {
      emit({ type: 'scanned', sceneId });
      return;
    }
    if (topic === 'qr_login.rejected') {
      emit({ type: 'rejected', sceneId });
      void cleanup();
      return;
    }
    if (topic === 'qr_login.expired') {
      emit({ type: 'expired', sceneId });
      void cleanup();
      return;
    }
    if (topic === 'qr_login.authorized') {
      const result = mapAuthorized(
        env.data,
        input.serverUrl,
        platformBaseUrl,
      );
      if (result === null) {
        // Protocol error — server pushed authorized but data was missing /
        // malformed. Treat as silent expire: clean up so the UI's expiry
        // path takes over (no token = no login).
        emit({ type: 'expired', sceneId });
        void cleanup();
        return;
      }
      emit({ type: 'authorized', sceneId, result });
      void cleanup();
      return;
    }
    // Unknown qr_login.* topic — forward-compat: ignore.
  };

  unsubPush = client.onPushMessage(onPush);

  return {
    scene,
    subscribe(listener) {
      if (disposed) {
        // Late subscriber post-terminal: hand back a no-op unsubscribe.
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel: cleanup,
  };
}

/** Map `qr_login.authorized` push data → `LoginResult` (PLATFORM mode).
 *  Returns `null` when wire shape is unrecognisable so caller can
 *  surface a protocol-error to UI (today: treated as silent expire). */
function mapAuthorized(
  data: unknown,
  serverUrl: string,
  platformBaseUrl: string,
): LoginResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as AuthorizedData;
  if (typeof d.userId !== 'number') return null;
  if (typeof d.accessToken !== 'string' || d.accessToken === '') return null;
  if (typeof d.refreshToken !== 'string') return null;
  const deviceId =
    typeof d.deviceId === 'string' && d.deviceId !== ''
      ? d.deviceId
      : typeof d.imDeviceId === 'string' && d.imDeviceId !== ''
        ? d.imDeviceId
        : null;
  if (deviceId === null) return null;
  return {
    serverUrl,
    userId: String(d.userId),
    accessToken: d.accessToken,
    deviceId,
    accountMode: 'platform',
    platformBaseUrl,
    refreshToken: d.refreshToken,
    // Wire-defense: server may omit empty arrays (kotlinx encodeDefaults).
    requiredActions: Array.isArray(d.requiredActions) ? d.requiredActions : [],
  };
}

// Re-export to keep wire-error taxonomy callable from one place even
// though this module doesn't currently throw `PlatformProtocolError`
// for authorized-payload issues (we silent-expire instead, matching
// spec QR_LOGIN_SPEC §6.3 "client recovers by re-issuing scene"). The
// import is kept so future tightening of malformed-data handling can
// flip to a thrown error without another diff dance.
export { PlatformProtocolError };
