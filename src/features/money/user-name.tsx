import { useTranslation } from 'react-i18next';
import { useUserProfile } from '@privchat/react';

/** Inline user display name: nickname > username > "User #uid". */
export function UserName({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const user = useUserProfile(userId);
  return <>{user?.nickname || user?.username || t('app.unknown_user', { id: userId })}</>;
}
