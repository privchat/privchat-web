import { useMemo } from 'react';
import type { PrivchatClient } from '@privchat/sdk';
import { getActiveAccessToken } from '@/lib/active-access-token';
import { loadSession } from '@/lib/session-storage';
import { getPlatformBaseUrl } from '@/lib/account-mode';
import { getActiveAccountKey } from '@/lib/active-account';
import { WorkspaceApi } from './api';

export function useWorkspaceApi(client: PrivchatClient, provided?: WorkspaceApi) {
  return useMemo(() => {
    if (provided) return provided;
    const uid = client.sessionSnapshot().user_id;
    const accountKey = getActiveAccountKey();
    return new WorkspaceApi(getPlatformBaseUrl() ?? '', () =>
      getActiveAccountKey() === accountKey && client.sessionSnapshot().user_id === uid && loadSession()?.user_id === uid ? getActiveAccessToken() : null);
  }, [client, provided]);
}
