// R8.3a — `PlatformAuthProvider` HTTP envelope client.
//
// Concrete PLATFORM implementation of `AccountAuthProvider`.
// Talks to `privchat-application`'s `/app/auth/*` endpoints; the
// byte-level contract (paths, request/response shapes, envelope,
// error model) is frozen in `docs/PLATFORM_AUTH_HTTP_CONTRACT.md`.
//
// Capability surface (R8.2c §3 / interface comment):
//   sendSmsCode    ✓
//   loginWithSms   ✓
//   refreshToken   ✓
//   loginWithPassword     — absent (Web v1 doesn't expose mobile+password)
//   registerWithPassword  — absent (no register endpoint on platform)
//   logout                — absent (server logout not in R8 v1)
//
// `serverUrl` (IM gateway WebSocket URL) is passed THROUGH from
// the input to `LoginResult.serverUrl`; the provider never
// connects to it. Splitting WS auth from HTTP auth is intentional
// — the unified token covers both audiences (R8.2c §1).

import type {
  AccountAuthProvider,
  LoginResult,
  QrLoginInput,
  QrLoginSession,
  SendSmsCodeInput,
  SendSmsCodeResult,
  SmsLoginInput,
} from './account-auth-provider';
import type { RequiredAction } from './required-action';
import { normalizePlatformBaseUrl } from './platform-base-url';
import { postEnvelope, requireData } from './platform-envelope';
import { PlatformConfigError } from './platform-errors';
import {
  getActiveQrUnauthClientFactory,
  startPlatformQrLoginWithClient,
} from './platform-qr-login';
import type { PersistedSession } from './session-storage';

/** Application `MemberLoginResponse` (TOKEN_UNIFICATION §8 LoginResponse).
 *  Only the fields Web actually maps. Server may send more (scope,
 *  issuer, sessionVersion, …); we tolerate unknown keys. */
interface UnifiedLoginResponseData {
  userId: number;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  /** Echoed for parity with native; Web doesn't read these. */
  tokenType?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  sessionVersion?: number;
  deviceCreated?: boolean;
  /** R8.4b — Post-login Required Actions. Server may omit the field
   *  entirely when the array is empty (kotlinx encode-defaults), so
   *  the type is optional and provider does `?? []` wire-defense. */
  requiredActions?: RequiredAction[];
}

/** Default cooldown when server doesn't return a Retry-After
 *  hint (it doesn't today). 60s matches the server's 5-per-60s
 *  rate limit window — safe one-size-fits-all. */
const DEFAULT_SMS_COOLDOWN_SECONDS = 60;

/** Server scene code for member login (privchat-application
 *  `enums.SmsScene.MEMBER_LOGIN.scene = 1`). R8.3 only uses this
 *  scene; reset-password / update-mobile / update-password are
 *  out of scope. */
const SCENE_LOGIN = 1;

export class PlatformAuthProvider implements AccountAuthProvider {
  readonly mode = 'platform' as const;

  /** Normalized at construction time; subsequent per-call inputs
   *  may carry their own `platformBaseUrl` (e.g. refreshToken
   *  reads it from the stored session) and re-normalize again. */
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = normalizePlatformBaseUrl(baseUrl);
  }

  async sendSmsCode(input: SendSmsCodeInput): Promise<SendSmsCodeResult> {
    if (input.scene !== 'login') {
      // Reserved for future scenes; R8.3a only supports 'login'.
      // Throw early so a typo in the caller surfaces as a config
      // bug, not a server-side validation error.
      throw new PlatformConfigError(
        `unsupported sendSmsCode scene: ${input.scene}`,
      );
    }
    const baseUrl = normalizePlatformBaseUrl(input.platformBaseUrl);
    await postEnvelope<unknown>(`${baseUrl}/auth/send-sms-code`, {
      mobile: input.mobile,
      scene: SCENE_LOGIN,
    });
    return { cooldownSeconds: DEFAULT_SMS_COOLDOWN_SECONDS };
  }

  async loginWithSms(input: SmsLoginInput): Promise<LoginResult> {
    const baseUrl = normalizePlatformBaseUrl(input.platformBaseUrl);
    const data = requireData(
      await postEnvelope<UnifiedLoginResponseData>(
        `${baseUrl}/auth/sms-login`,
        {
          mobile: input.mobile,
          smsCode: input.smsCode,
          device: serializeDevice(input.device),
        },
      ),
      'sms-login',
    );
    return {
      // serverUrl passes through from caller — provider never
      // touches the IM gateway URL. UI captures it from env / form.
      serverUrl: input.serverUrl,
      userId: String(data.userId),
      accessToken: data.accessToken,
      deviceId: data.deviceId,
      accountMode: 'platform',
      platformBaseUrl: baseUrl,
      refreshToken: data.refreshToken,
      // Wire-defense: server omits empty arrays.
      requiredActions: data.requiredActions ?? [],
    };
  }

  async refreshToken(session: PersistedSession): Promise<PersistedSession> {
    if (session.account_mode !== 'platform') {
      throw new PlatformConfigError(
        'PlatformAuthProvider.refreshToken requires session.account_mode === "platform"',
      );
    }
    if (
      session.platform_base_url === undefined ||
      session.platform_base_url === ''
    ) {
      throw new PlatformConfigError(
        'PlatformAuthProvider.refreshToken requires session.platform_base_url',
      );
    }
    if (
      session.refresh_token === undefined ||
      session.refresh_token === ''
    ) {
      throw new PlatformConfigError(
        'PlatformAuthProvider.refreshToken requires session.refresh_token',
      );
    }
    const baseUrl = normalizePlatformBaseUrl(session.platform_base_url);
    const data = requireData(
      await postEnvelope<UnifiedLoginResponseData>(
        `${baseUrl}/auth/refresh-token`,
        {
          refreshToken: session.refresh_token,
          deviceId: session.device_id,
        },
      ),
      'refresh-token',
    );
    if (String(data.userId) !== session.user_id) {
      // A mismatched uid in the refresh response means the token
      // was reissued for a different account — never trust silently.
      // Caller's policy is to drop the session and force re-login.
      throw new PlatformConfigError(
        `refresh-token uid mismatch: session=${session.user_id}, response=${data.userId}`,
      );
    }
    return {
      ...session,
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
      // server may echo a different deviceId only when it just
      // created a new device row (rare on refresh); honor it.
      device_id: data.deviceId !== '' ? data.deviceId : session.device_id,
      platform_base_url: baseUrl,
      // saved_at is bumped by the persistence layer
      // (`session-storage.persistSessionForAccount`), not here.
      saved_at: session.saved_at,
    };
  }

  /** R8.5b — start QR login session via unauth WS RPC to privchat-server.
   *  Delegates to `startPlatformQrLoginWithClient` with the production
   *  unauth-client factory. See `PLATFORM_QR_LOGIN_CONTRACT` for the wire
   *  flow + state machine. */
  startQrLogin(input: QrLoginInput): Promise<QrLoginSession> {
    // `getActiveQrUnauthClientFactory()` returns the production
    // factory in real builds; the test harness can install a fake
    // factory before triggering the production code path so UI
    // smokes can drive the QR session without a real WS server.
    return startPlatformQrLoginWithClient(
      input,
      getActiveQrUnauthClientFactory(),
    );
  }
}

/** Map Web's internal `DeviceInfo` (snake_case, with `device_type`)
 *  to the application HTTP shape (camelCase, with `platform`).
 *  Per PLATFORM_AUTH_HTTP_CONTRACT §11.2 mapping table. */
function serializeDevice(device: SmsLoginInput['device']): {
  deviceId: string;
  platform: string;
  deviceName: string;
  appVersion: string;
  osVersion?: string;
} {
  return {
    deviceId: device.device_id,
    platform: device.device_type,
    deviceName: device.device_name,
    appVersion: device.app_version,
    ...(device.os_version === undefined
      ? {}
      : { osVersion: device.os_version }),
  };
}
