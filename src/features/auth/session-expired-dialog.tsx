// Shown when the SDK fires `session_expired` — i.e. the access token is
// terminally invalid and a refresh could not save it (refresh token
// expired/revoked, platform 401/403, or no refresh available). Any close
// path (button / X / Esc / outside-click) routes back to login, since
// there is no recoverable state to return to.

import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function SessionExpiredDialog({
  open,
  onConfirm,
}: {
  open: boolean;
  /** Invoked on any dismissal — clears the session and returns to login. */
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onConfirm();
      }}
    >
      <DialogContent data-testid="session-expired-dialog">
        <DialogHeader>
          <DialogTitle>{t('session_expired.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('session_expired.body')}</p>
        <div className="mt-4 flex justify-end">
          <Button onClick={onConfirm} data-testid="session-expired-confirm">
            {t('session_expired.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
