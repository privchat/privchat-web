// Web side of the SDK-owned auth-refresh flow.
//
// Builds the `AuthRefreshConfig` the SDK calls (via `configureAuthRefresh`)
// when an access token is rejected as expired. The refresh itself is
// mode-aware through the existing `AccountAuthProvider.refreshToken`:
//   - PLATFORM → real HTTP `/auth/refresh-token` (rotates access + refresh)
//   - BUILTIN  → passthrough today (the backend issues no separate refresh
//                token yet; the seam is here so a future builtin refresh
//                needs no coordinator change). A passthrough means builtin
//                cannot silently refresh — a genuinely-expired builtin
//                token falls through to re-login.
//
// `onTokensRefreshed` persists the new tokens by MERGING onto the freshest
// stored session: override the access token, keep the old refresh token
// unless the server rotated it, and let the storage layer bump `saved_at`.

import type {
  AuthRefreshConfig,
  AuthRefreshContext,
  AuthRefreshResult,
} from '@privchat/sdk';
import { SessionExpiredError } from '@privchat/sdk';
import { getAuthProvider } from './account-auth-provider';
import {
  loadSession,
  persistSessionForAccount,
  type PersistedSession,
} from './session-storage';

export function buildAuthRefresh(): AuthRefreshConfig {
  return {
    refreshAuth: async (_ctx: AuthRefreshContext): Promise<AuthRefreshResult> => {
      const current = loadSession();
      if (current === null) {
        // Nothing to refresh from → terminal; SDK fires session_expired.
        throw new SessionExpiredError('no active session to refresh');
      }
      const provider = await getAuthProvider();
      if (typeof provider.refreshToken !== 'function') {
        throw new SessionExpiredError('auth provider does not support refresh');
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
