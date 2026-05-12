// Bridges react-i18next strings to the SDK's pure title resolver.
// The resolver is framework-free and accepts a small i18n surface as
// arguments (see `ConversationTitleI18n` in @privchat/react). Web wraps
// it once here so every consumer (list row, panel header) can call the
// resolver with consistent translations.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationTitleI18n } from '@privchat/react';

export function useConversationTitleI18n(): ConversationTitleI18n {
  const { t } = useTranslation();
  return useMemo<ConversationTitleI18n>(
    () => ({
      system_notifications: t('app.system_notifications'),
      unknown_user_template: (id) => t('app.unknown_user', { id }),
      unknown_group_template: (id) => t('app.unknown_group', { id }),
    }),
    [t],
  );
}
