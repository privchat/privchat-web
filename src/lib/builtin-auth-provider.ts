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

  // BUILTIN today doesn't expose a separate refresh token flow;
  // the server's access token stays valid until session_version
  // bumps. The seam exists for consistency; the implementation
  // is a deliberate "session unchanged" passthrough so callers
  // can call it unconditionally.
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
        // R8.4b: BUILTIN never has required actions; the framework is
        // wired but server side returns [] for builtin auth paths.
        requiredActions: [],
      };
    } finally {
      await handle.client.dispose().catch(() => {});
    }
  }
}
