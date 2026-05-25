// R8.1 + R8.2 — `BuiltinAuthProvider` implementation.
//
// Wraps the existing `account/auth/login` and
// `account/user/register` RPCs that LoginPage used to call
// inline: spin up a temporary `PrivchatClient`, connect, RPC,
// dispose. Returns a `LoginResult` carrying the credentials the
// App.tsx onLoggedIn path expects.
//
// R8.2 made this the production code path: LoginPage no longer
// constructs its own temp client; both login and register go
// through this provider. `BuiltinAuthProvider`'s contract is
// byte-for-byte equivalent to the previous inline flow — same
// route names, same DeviceInfo shape, same dispose-in-finally
// safety, same error propagation. Existing e2e specs cover the
// regression window.

import type {
  AccountAuthProvider,
  LoginResult,
  PasswordLoginInput,
} from './account-auth-provider';
import { createPrivchat } from './privchat-client';

interface CredentialRequest {
  username: string;
  password: string;
  device_id: string;
  device_info: {
    device_id: string;
    device_type: string;
    app_id: string;
    device_name: string;
    app_version: string;
  };
}

interface CredentialResponse {
  user_id: number;
  token: string;
  device_id: string;
  /** Long-TTL refresh token issued by `account/auth/login` (server
   *  `login.rs` §7.1). Used by the SDK-owned auth-refresh flow to mint a
   *  fresh access token via `account/auth/refresh` (an anonymous-
   *  whitelisted route). */
  refresh_token?: string;
}

const LOGIN_ROUTE = 'account/auth/login';
const REGISTER_ROUTE = 'account/user/register';

export class BuiltinAuthProvider implements AccountAuthProvider {
  readonly mode = 'builtin' as const;

  loginWithPassword(input: PasswordLoginInput): Promise<LoginResult> {
    return this.runCredentialRpc(LOGIN_ROUTE, input);
  }

  registerWithPassword(input: PasswordLoginInput): Promise<LoginResult> {
    return this.runCredentialRpc(REGISTER_ROUTE, input);
  }

  // SMS login is a PLATFORM-only capability per the design note;
  // BUILTIN deliberately omits the method from the prototype so
  // `typeof provider.loginWithSms === 'function'` returns false
  // and UI capability checks resolve cleanly. PLATFORM provider
  // implements the method; UI gates the affordance via
  // `capabilities.smsLogin`.

  // BUILTIN refresh is NOT done here: the provider has no SDK client
  // instance, and `account/auth/refresh` is an SDK RPC. The SDK-owned
  // auth-refresh flow drives it instead — `auth-refresh-provider.ts`
  // dispatches BUILTIN to `client.refreshAccessToken(refresh_token,
  // device_id)`. This passthrough remains only so the provider interface
  // stays satisfiable for any caller that invokes it directly.
  refreshToken = async (
    session: import('./session-storage').PersistedSession,
  ): Promise<import('./session-storage').PersistedSession> => session;

  // No server-side logout RPC in BUILTIN today — the existing
  // `clearSession()` localStorage wipe is enough. Method is
  // omitted intentionally (interface marks it optional).

  /** Shared temp-client lifecycle for both login and register.
   *  The client connects, runs ONE RPC, and is disposed in a
   *  `finally` block — guarantees no half-connected websocket
   *  leaks regardless of whether the RPC succeeds, throws, or
   *  the caller cancels. */
  private async runCredentialRpc(
    route: string,
    input: PasswordLoginInput,
  ): Promise<LoginResult> {
    const handle = createPrivchat({ url: input.serverUrl });
    try {
      await handle.client.connect();
      const resp = await handle.client.rpcCallTyped<
        CredentialRequest,
        CredentialResponse
      >(route, {
        username: input.username,
        password: input.password,
        device_id: input.device.device_id,
        device_info: {
          device_id: input.device.device_id,
          device_type: input.device.device_type,
          app_id: input.device.app_id,
          device_name: input.device.device_name,
          app_version: input.device.app_version,
        },
      });
      return {
        serverUrl: input.serverUrl,
        userId: String(resp.user_id),
        accessToken: resp.token,
        deviceId: resp.device_id,
        accountMode: 'builtin',
        // Persist the server-issued refresh token so the SDK auth-refresh
        // coordinator can silently renew the access token. (login-page
        // persists `result.refreshToken` mode-agnostically.)
        ...(resp.refresh_token !== undefined
          ? { refreshToken: resp.refresh_token }
          : {}),
        // R8.4b: BUILTIN never has required actions; the framework is
        // wired but server side returns [] for builtin auth paths.
        requiredActions: [],
      };
    } finally {
      await handle.client.dispose().catch(() => {});
    }
  }
}
