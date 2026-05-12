// R8.4c — module-level `AccessTokenProvider` callback wired to the active
// session blob. Used by `getRequiredActionsProvider` and `getProfileProvider`
// in App.tsx so providers don't need to re-instantiate when the active
// account or refresh-token rotates.

import { loadSession } from './session-storage';

export function getActiveAccessToken(): string | null {
  const session = loadSession();
  return session?.access_token ?? null;
}
