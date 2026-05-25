// Web side of the SDK-owned auth-refresh flow.
//
// Builds the `AuthRefreshConfig` the SDK calls (via `configureAuthRefresh`)
// when an access token is rejected as expired. Refresh is mode-aware:
//   - PLATFORM → real HTTP `/auth/refresh-token` via PlatformAuthProvider
//     (rotates access + refresh).
//   - BUILTIN  → the SDK RPC `client.refreshAccessToken(refresh_token,
//     device_id)` → `account/auth/refresh`, which the server exposes as an
//     anonymous-whitelisted route (callable while connected-but-unauth, so
//     no deadlock). The refresh token comes from `account/auth/login`
//     (captured by BuiltinAuthProvider into the persisted session).
//
// `onTokensRefreshed` persists the new tokens by MERGING onto the freshest
// stored session: override the access token, keep the old refresh token
// unless the server rotated it, and let the storage layer bump `saved_at`.

import type {
  AuthRefreshConfig,
  AuthRefreshContext,
  AuthRefreshResult,
  PrivchatClient,
} from '@privchat/sdk';
import { SessionExpiredError } from '@privchat/sdk';
import { getAuthProvider } from './account-auth-provider';
import {
  loadSession,
  persistSessionForAccount,
  sessionAccountMode,
  type PersistedSession,
} from './session-storage';

export function buildAuthRefresh(client: PrivchatClient): AuthRefreshConfig {
  return {
    refreshAuth: async (_ctx: AuthRefreshContext): Promise<AuthRefreshResult> => {
      const current = loadSession();
      if (current === null) {
        // Nothing to refresh from → terminal; SDK fires session_expired.
        throw new SessionExpiredError('no active session to refresh');
      }

      if (sessionAccountMode(current) === 'platform') {
        const provider = await getAuthProvider();
        if (typeof provider.refreshToken !== 'function') {
          throw new SessionExpiredError('platform provider does not support refresh');
        }
        const updated = await provider.refreshToken(current);
        return {
          accessToken: updated.access_token,
          deviceId: updated.device_id,
          userId: updated.user_id,
          ...(updated.refresh_token !== undefined
            ? { refreshToken: updated.refresh_token }
            : {}),
        };
      }

      // BUILTIN: refresh over the live SDK connection via the anonymous
      // `account/auth/refresh` route. Requires a stored refresh token
      // (captured at login). `refreshAccessToken` throws RefreshTokenError
      // on 10009/10010 → the SDK coordinator turns that into session_expired.
      if (current.refresh_token === undefined || current.refresh_token === '') {
        throw new SessionExpiredError('builtin session has no refresh token');
      }
      const r = await client.refreshAccessToken(current.refresh_token, current.device_id);
      return {
        accessToken: r.access_token,
        deviceId: current.device_id,
        userId: current.user_id,
        // B1 non-rotation: server may omit refresh_token → keep the old one.
        refreshToken: r.refresh_token ?? current.refresh_token,
      };
    },

    onTokensRefreshed: async (tokens) => {
      // Merge onto the freshest persisted session (do NOT clobber fields
      // the refresh didn't touch). Rotated refresh token overrides; absent
      // → keep the existing one. `saved_at` is bumped by the storage layer.
      const current = loadSession();
      if (current === null) return;
      const merged: Omit<PersistedSession, 'saved_at'> = {
        url: current.url,
        user_id: tokens.userId ?? current.user_id,
        access_token: tokens.accessToken,
        device_id: tokens.deviceId ?? current.device_id,
        ...(current.account_mode !== undefined
          ? { account_mode: current.account_mode }
          : {}),
        ...(current.platform_base_url !== undefined
          ? { platform_base_url: current.platform_base_url }
          : {}),
        ...((tokens.refreshToken ?? current.refresh_token) !== undefined
          ? { refresh_token: tokens.refreshToken ?? current.refresh_token }
          : {}),
      };
      await persistSessionForAccount(merged);
    },
  };
}
