// react-i18next adapter for the presence formatter. Keeping the adapter
// localised here means `formatPresenceLine` stays pure / testable, and
// any host that wants different copy (Tauri, Cocos) can construct its
// own LastSeenI18n without the i18next dependency.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LastSeenI18n } from './format-last-seen';

export function useLastSeenI18n(): LastSeenI18n {
  const { t } = useTranslation();
  return useMemo<LastSeenI18n>(
    () => ({
      online: t('presence.online'),
      offline: t('presence.offline'),
      just_now: t('presence.just_now'),
      minutes_ago: (n) => t('presence.minutes_ago', { count: n }),
      hours_ago: (n) => t('presence.hours_ago', { count: n }),
      days_ago: (n) => t('presence.days_ago', { count: n }),
      long_ago: (date) => t('presence.long_ago', { date }),
    }),
    [t],
  );
}
