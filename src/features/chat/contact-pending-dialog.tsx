// Friend-requests dialog. Lists incoming pending applications and lets
// the user accept them inline. The list isn't kept in sync via observers
// because it's an ephemeral UI surface — we re-fetch each time the
// dialog opens (open === true). Accept removes the row optimistically.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { FriendPendingItem } from '@privchat/sdk';
import {
  useFriendAccept,
  useFriendPending,
  useRefreshFriendships,
} from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { captureException } from '@/lib/error-reporter';
import { Avatar } from './avatar';
import { errorText } from './error-text';

export function ContactPendingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const fetchPending = useFriendPending();
  const acceptFriend = useFriendAccept();
  const refreshFriendships = useRefreshFriendships();

  const [items, setItems] = useState<FriendPendingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [acceptingUid, setAcceptingUid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPending()
      .then((resp) => {
        if (cancelled) return;
        setItems(resp.requests);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        captureException(e, { source: 'contact-pending.list' });
        setError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchPending]);

  const handleAccept = async (item: FriendPendingItem) => {
    if (acceptingUid !== null) return;
    setAcceptingUid(item.from_user_id);
    setError(null);
    try {
      await acceptFriend(item.from_user_id);
      setItems((prev) =>
        prev.filter((r) => r.from_user_id !== item.from_user_id),
      );
      // Pull fresh friendships immediately so the new contact appears
      // in the sidebar without waiting for the next poll tick.
      void refreshFriendships();
    } catch (e) {
      captureException(e, { source: 'contact-pending.accept' });
      setError(errorText(e));
    } finally {
      setAcceptingUid(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('contacts.pending_title')}</DialogTitle>
        </DialogHeader>
        {error !== null && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t('contacts.pending_empty')}
            </div>
          )}
          <ul className="divide-y">
            {items.map((item) => {
              const display = item.user.nickname || item.user.username;
              return (
                <li
                  key={item.from_user_id}
                  className="flex items-center gap-3 py-2"
                >
                  <Avatar
                    seed={`u:${item.from_user_id}`}
                    label={display}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{display}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      @{item.user.username}
                      {item.message !== undefined && item.message !== '' && (
                        <> · {item.message}</>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void handleAccept(item)}
                    disabled={acceptingUid !== null}
                  >
                    {acceptingUid === item.from_user_id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t('contacts.accept')
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
