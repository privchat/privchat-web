import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrivchatClient } from '@privchat/sdk';
import { getConfiguredAccountMode } from '@/lib/account-mode';
import { useWorkspaceApi } from './account-api';

/** Account preference the server reads to write text for this user in their language. */
const LANGUAGE_PREFERENCE = '/account/preferences/app.language';

/**
 * Reports the language picked in this client to the account, once signed in and whenever it
 * changes, so server-written text (workspace decisions, employee replies) follows it. Best effort:
 * a failed write leaves the previous language and is retried on the next change or sign-in.
 */
export function AccountLanguageSync({ client }: { client: PrivchatClient }) {
  const { i18n } = useTranslation();
  const api = useWorkspaceApi(client);
  const language = i18n.language;
  useEffect(() => {
    if (getConfiguredAccountMode() !== 'platform' || !language) return;
    let live = true;
    void (async () => {
      try {
        const current = await api.get<{ value: unknown; version: number }>(LANGUAGE_PREFERENCE);
        if (!live || current.value === language) return;
        await api.put(LANGUAGE_PREFERENCE, { value: language, version: current.version ?? 0 });
      } catch { /* retried on the next change or sign-in */ }
    })();
    return () => { live = false; };
  }, [api, language]);
  return null;
}
