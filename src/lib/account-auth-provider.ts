// `AccountAuthProvider` seam.
//
// One interface, two implementations:
//   - `BuiltinAuthProvider` (R8.1/R8.2): wraps server's
//     `account/auth/login` + `account/user/register` RPCs
//   - `PlatformAuthProvider` (R8.3a): HTTP client for
//     `privchat-application/auth/*` (SMS-primary, no register)
//
// R8.2c capability model: every method except `mode` is optional.
// Each provider exposes only what its mode supports; UI gates by
// `typeof provider.method === 'function'`, NEVER by
// `mode === 'platform'`. The matrix:
//
//   method                BUILTIN          PLATFORM (R8.3)
//   ────────────────────────────────────────────────────────
//   loginWithPassword     ✓                ✗  (endpoint exists,
//                                              not exposed v1)
//   registerWithPassword  ✓                ✗  (no register concept)
//   sendSmsCode           ✗                ✓
//   loginWithSms          ✗                ✓
//   refreshToken          ✓ (no-op)        ✓
//   logout                ✗                ✗  (R8 v1 doesn't ship
//                                              server logout)

import type { AccountMode } from './account-mode';
import {
  getConfiguredAccountMode,
  getPlatformBaseUrl,
} from './account-mode';
import type { RequiredAction } from './required-action';
import type {
  QrLoginInput,
  QrLoginSession,
} from './platform-qr-login';

export type { QrLoginInput, QrLoginScene, QrLoginEvent, QrLoginSession } from './platform-qr-login';

export interface DeviceInfo {
  device_id: string;
  device_type: string;
  app_id: string;
  device_name: string;
  app_version: string;
  os_version?: string;
}

export interface PasswordLoginInput {
  /** WebSocket URL of the IM gateway. Same value as
   *  `PersistedSession.url`. */
  serverUrl: string;
  username: string;
  password: string;
  device: DeviceInfo;
}

export interface SmsLoginInput {
  /** R8.2c: PLATFORM HTTP base URL (e.g. `https://app.example.com/app`).
   *  Provider re-normalizes via `normalizePlatformBaseUrl`. */
  platformBaseUrl: string;
  /** IM gateway WebSocket URL — passes straight through to
   *  `LoginResult.serverUrl`; provider does NOT contact it. */
  serverUrl: string;
  /** Mobile in international format (e.g. `+8613800138000`). */
  mobile: string;
  smsCode: string;
  device: DeviceInfo;
}

export interface SendSmsCodeInput {
  /** PLATFORM HTTP base URL. See `SmsLoginInput.platformBaseUrl`. */
  platformBaseUrl: string;
  /** Mobile in international format. */
  mobile: string;
  /** R8.3a only uses 'login' (server scene=1, MEMBER_LOGIN);
   *  reserved for future scenes (reset-password, etc.). */
  scene: 'login';
}

export interface SendSmsCodeResult {
  /** UI uses this to start its local cooldown timer. R8.3
   *  defaults to 60 (server limits 5/60s/IP and doesn't return a
   *  Retry-After today; 60 is the safest one-size-fits-all). */
  cooldownSeconds: number;
}

export interface LoginResult {
  serverUrl: string;
  userId: string;
  accessToken: string;
  deviceId: string;
  /** Echoed from the provider that minted this session. The
   *  registry persists it under `AccountEntry.mode` so future
   *  auto-login picks the right provider. */
  accountMode: AccountMode;
  /** Only set when `accountMode === 'platform'`. */
  platformBaseUrl?: string;
  /** Optional refresh token; PLATFORM provides one, BUILTIN
   *  doesn't today. */
  refreshToken?: string;
  /** R8.4b — Post-login Required Actions from server (PLATFORM only).
   *  Always present as an array (defaults to `[]` when server omits
   *  the field, per wire-defense rule in
   *  PLATFORM_REQUIRED_ACTIONS_CONTRACT §14b). Callers in R8.4c will
   *  inspect this to decide whether to render `RequiredActionFlow`
   *  before transitioning to ChatWorkspace. */
  requiredActions: RequiredAction[];
}

import type { PersistedSession } from './session-storage';

export interface AccountAuthProvider {
  readonly mode: AccountMode;
  /** R8.2c: optional. BUILTIN implements (username + password
   *  via server RPC). PLATFORM v1 does NOT implement — the
   *  application `/auth/login` endpoint exists but Web doesn't
   *  expose it (R8.2c §3 design decision). UI gates by
   *  `typeof provider.loginWithPassword === 'function'`. */
  loginWithPassword?(input: PasswordLoginInput): Promise<LoginResult>;
  /** BUILTIN-only "register a new user via username + password"
   *  (legacy `account/user/register` RPC). PLATFORM has no
   *  independent register endpoint — SMS-login auto-registers on
   *  first sight of a mobile. UI gates by
   *  `typeof provider.registerWithPassword === 'function'`. */
  registerWithPassword?(input: PasswordLoginInput): Promise<LoginResult>;
  /** R8.3a — PLATFORM only: trigger SMS code dispatch for the
   *  given mobile. UI must call this before `loginWithSms`. The
   *  result's `cooldownSeconds` drives the local resend timer. */
  sendSmsCode?(input: SendSmsCodeInput): Promise<SendSmsCodeResult>;
  /** PLATFORM only: complete login with the SMS code obtained
   *  from a prior `sendSmsCode` call. First-time login on a
   *  mobile auto-registers (server-side; no separate UX). */
  loginWithSms?(input: SmsLoginInput): Promise<LoginResult>;
  /** Refresh the access token from a persisted session. PLATFORM
   *  hits the application `/auth/refresh-token` endpoint and
   *  returns a freshened `PersistedSession` blob (refresh token
   *  may or may not rotate — Phase A doesn't rotate). BUILTIN
   *  today is a no-op (server keeps the access token alive
   *  lazily) and returns the input unchanged. */
  refreshToken?(session: PersistedSession): Promise<PersistedSession>;
  /** Optional server-side logout RPC. R8 v1 ships neither
   *  BUILTIN nor PLATFORM logout server call — `clearSession()`
   *  is sufficient for current UX. Reserved for a future round. */
  logout?(session: PersistedSession): Promise<void>;
  /** R8.5b — PLATFORM only: start an unauth-WS QR login session.
   *  Returns a `QrLoginSession` carrying the scene + an event
   *  stream the UI subscribes to. BUILTIN omits the method
   *  entirely so `typeof provider.startQrLogin === 'function'`
   *  resolves false and UI capability checks gate cleanly. The
   *  flow itself is documented in PLATFORM_QR_LOGIN_CONTRACT
   *  (web docs) and QR_LOGIN_SPEC (server docs). */
  startQrLogin?(input: QrLoginInput): Promise<QrLoginSession>;
}

/** Throw on every method that isn't supported in a given mode.
 *  Identifiable by name so error reporters can group these
 *  separately from real network / auth errors. */
export class AuthMethodNotSupportedError extends Error {
  override readonly name = 'AuthMethodNotSupportedError';
  constructor(public readonly method: string, public readonly mode: AccountMode) {
    super(`auth method ${method} is not supported in ${mode} mode`);
  }
}

/** Legacy from R8.1 PLATFORM stub. R8.3a removed all
 *  `NotImplementedYetError` throws from `PlatformAuthProvider`
 *  (the methods that used to throw are now either implemented or
 *  absent from the prototype). Kept exported so any external
 *  reference still type-checks; remove in R8.4 if unused. */
export class NotImplementedYetError extends Error {
  override readonly name = 'NotImplementedYetError';
  constructor(public readonly featurePath: string) {
    super(`placeholder: ${featurePath} not implemented yet`);
  }
}

// Pluggable cache so tests / future SSR can reset.
let cachedProvider: AccountAuthProvider | null = null;

/** Factory. Returns one of the two implementations based on
 *  compile-time config. Cached at module level — flipping the
 *  env var at runtime would not change the answer. */
export async function getAuthProvider(): Promise<AccountAuthProvider> {
  if (cachedProvider !== null) return cachedProvider;
  const mode = getConfiguredAccountMode();
  if (mode === 'platform') {
    const { PlatformAuthProvider } = await import('./platform-auth-provider');
    const baseUrl = getPlatformBaseUrl();
    if (baseUrl === null) {
      // Same assertion as `assertAccountModeConfig`, surfaced
      // here too so any caller of `getAuthProvider()` gets a
      // loud error instead of a half-built provider.
      throw new Error(
        'VITE_PRIVCHAT_PLATFORM_BASE_URL is required when VITE_PRIVCHAT_ACCOUNT_MODE=platform',
      );
    }
    cachedProvider = new PlatformAuthProvider(baseUrl);
  } else {
    const { BuiltinAuthProvider } = await import('./builtin-auth-provider');
    cachedProvider = new BuiltinAuthProvider();
  }
  return cachedProvider;
}

/** Test-only: reset the cached provider so a spec can re-run the
 *  factory after changing `import.meta.env`. Production callers
 *  never need this. */
export function __resetAuthProviderForTests(): void {
  cachedProvider = null;
}
