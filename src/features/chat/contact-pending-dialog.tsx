// Friend-requests dialog. Lists incoming pending applications and lets
// the user accept them inline. The list isn't kept in sync via observers
// because it's an ephemeral UI surface — we re-fetch each time the
// dialog opens (open === true). Accept removes the row optimistically.
//
// Post-accept side effects:
//   1. Refresh the local friendship cache so the new contact shows in
//      the sidebar before the next 30s poll tick.
//   2. Send a single system text message into the new direct channel.
//      Both sides see it in their new conversation (the applicant
//      gets a localized "X accepted your friend request" hint without
//      requiring server changes). Best-effort — failure here doesn't
//      block the accept itself.
//   3. Close the dialog and open the new chat for the acceptor so
//      they don't have to navigate back to the contact list and click
//      the freshly-added friend.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { FriendPendingItem } from '@privchat/sdk';
import { ContentMessageType } from '@privchat/sdk';
import {
  useFriendAccept,
  useFriendPending,
  usePrivchatClient,
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

const CHANNEL_TYPE_DIRECT = 1;

export function ContactPendingDialog({
  open,
  onOpenChange,
  onOpenChat,
  onCountChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful accept so the parent can switch the
   *  active panel to the new direct conversation. */
  onOpenChat: (user_id: string) => void;
  /** Mirrors the locally-tracked pending count back to the parent
   *  whenever the list shrinks (accept) or refreshes (dialog open).
   *  Lets the header bell badge stay in sync without re-polling on
   *  every render. */
  onCountChange: (count: number) => void;
}) {
  const { t } = useTranslation();
  const adapter = usePrivchatClient();
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
        onCountChange(resp.requests.length);
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
  }, [open, fetchPending, onCountChange]);

  const handleAccept = async (item: FriendPendingItem) => {
    if (acceptingUid !== null) return;
    setAcceptingUid(item.from_user_id);
    setError(null);
    try {
      // Server returns the (existing or freshly-created) direct
      // channel_id; we use it to post the greeting system message
      // straight into the new chat.
      const channelId = await acceptFriend(item.from_user_id);
      const nextItems = items.filter(
        (r) => r.from_user_id !== item.from_user_id,
      );
      setItems(nextItems);
      onCountChange(nextItems.length);
      // Pull fresh friendships immediately so the new contact appears
      // in the sidebar without waiting for the next poll tick.
      void refreshFriendships();

      // Greeting system message — best-effort. Captured + swallowed
      // so a failure here doesn't roll back the accept or block the
      // navigation. The text mirrors what the user expects ("我已经
      // 通过你的好友申请") and appears as a `content_type=system` row
      // on both sides of the new direct channel.
      const fromUid = adapter.sessionSnapshot().user_id;
      if (fromUid !== undefined) {
        try {
          await adapter.sendTextMessage({
            channel_id: String(channelId),
            channel_type: CHANNEL_TYPE_DIRECT,
            from_uid: fromUid,
            content: t('contacts.accepted_greeting'),
            message_type: ContentMessageType.System,
          });
        } catch (e) {
          captureException(e, { source: 'contact-pending.greeting' });
        }
      }

      // Close + jump to the new chat. Closing first lets the parent's
      // `onOpenChange(false)` re-fetch the authoritative pending count.
      onOpenChange(false);
      onOpenChat(String(item.from_user_id));
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
