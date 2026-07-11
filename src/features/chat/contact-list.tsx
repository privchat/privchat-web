// ContactList — friends tab in the sidebar. Headless data from
// useFriendList (joins FriendshipRecord with cached UserRecord).
//
// Click flow: parent passes `onOpen(user_id)` which calls
// useOpenDirectConversation() and switches the active panel. We pass the
// `openingUid` back in so the row can show a spinner state and also so we
// debounce double-taps on slow networks (the row stays disabled while the
// SDK request is in flight).
//
// The header carries two entry points: pending friend requests (bell)
// and find-friend search (user-plus). Both open dialogs whose state is
// owned here. The bell carries a badge with the live pending count —
// fetched on mount + polled at the same cadence the friend-list refresh
// uses (30s) so a freshly-arrived request shows up without the user
// needing to open the dialog first.

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BellRing, UserPlus } from 'lucide-react';
import { useFriendList, useFriendPending, useUserProfile } from '@privchat/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { captureException } from '@/lib/error-reporter';
import { cn } from '@/lib/utils';
import { useLazyMount } from '@/lib/use-lazy-mount';
import { Avatar } from './avatar';
import { ProfileCard } from './profile-card';

const PENDING_POLL_INTERVAL_MS = 30_000;

// Both dialogs are user-triggered — pending friend requests + find-
// friend search. Neither is on the first-paint path; both pull in
// their own data (search results, pending list) so it's worth
// keeping them out of the main chunk until needed.
const ContactPendingDialog = lazy(() =>
  import('./contact-pending-dialog').then((m) => ({
    default: m.ContactPendingDialog,
  })),
);
const ContactFindDialog = lazy(() =>
  import('./contact-find-dialog').then((m) => ({
    default: m.ContactFindDialog,
  })),
);

export interface ContactListProps {
  onOpen: (user_id: string, displayName?: string) => void;
  openingUid: string | null;
  className?: string;
}

export function ContactList({ onOpen, openingUid, className }: ContactListProps) {
  const { t } = useTranslation();
  const friends = useFriendList();
  const fetchPending = useFriendPending();
  const [pendingOpen, setPendingOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    try {
      const resp = await fetchPending();
      setPendingCount(resp.requests.length);
    } catch (e) {
      // Swallow — badge just stays at its last known value. Errors
      // here would otherwise spam the console on every poll tick when
      // the gateway is unreachable.
      captureException(e, { source: 'contact-list.pending-count' });
    }
  }, [fetchPending]);

  // Fetch on mount + poll at the same cadence as `useFriendList`.
  // Re-running when `fetchPending` flips identity (account switch
  // through the same component) re-fetches against the new adapter.
  useEffect(() => {
    void refreshPendingCount();
    const handle = setInterval(() => {
      void refreshPendingCount();
    }, PENDING_POLL_INTERVAL_MS);
    return () => {
      clearInterval(handle);
    };
  }, [refreshPendingCount]);

  // Re-fetch as soon as the dialog closes — accept/reject inside the
  // dialog mutates `pendingCount` optimistically, but a fresh read
  // catches any concurrent change (other tab / device).
  const onPendingOpenChange = useCallback(
    (next: boolean) => {
      setPendingOpen(next);
      if (!next) void refreshPendingCount();
    },
    [refreshPendingCount],
  );

  return (
    <div className={cn('flex h-full flex-col bg-card', className)}>
      <header className="flex shrink-0 items-center justify-end gap-1 border-b px-2 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setPendingOpen(true)}
          aria-label={t('contacts.pending_title')}
          title={t('contacts.pending_title')}
          className="relative"
        >
          <BellRing className="h-4 w-4" />
          {pendingCount > 0 && (
            <span
              data-testid="contacts-pending-badge"
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-[10px] font-mono leading-4 text-white text-center"
            >
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setFindOpen(true)}
          aria-label={t('contacts.find_title')}
          title={t('contacts.find_title')}
        >
          <UserPlus className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {friends.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t('contacts.empty')}
          </div>
        )}
        <ul className="divide-y">
          {friends.map((friend) => {
            const opening = openingUid === friend.user_id;
            return (
              <ContactRow
                key={friend.user_id}
                userId={friend.user_id}
                title={friend.title}
                subtitle={friend.subtitle}
                disabled={openingUid !== null}
                opening={opening}
                onSelect={() => onOpen(friend.user_id, friend.title)}
              />
            );
          })}
        </ul>
      </div>

      <LazyContactPendingDialog
        open={pendingOpen}
        onOpenChange={onPendingOpenChange}
        onOpenChat={onOpen}
        onCountChange={setPendingCount}
      />
      <LazyContactFindDialog
        open={findOpen}
        onOpenChange={setFindOpen}
        onOpenChat={onOpen}
        openingUid={openingUid}
      />
    </div>
  );
}

function LazyContactPendingDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat: (user_id: string) => void;
  onCountChange: (count: number) => void;
}) {
  const mounted = useLazyMount(props.open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <ContactPendingDialog {...props} />
    </Suspense>
  );
}

function LazyContactFindDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat: (user_id: string) => void;
  openingUid: string | null;
}) {
  const mounted = useLazyMount(props.open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <ContactFindDialog {...props} />
    </Suspense>
  );
}

function ContactRow({
  userId,
  title,
  subtitle,
  disabled,
  opening,
  onSelect,
}: {
  userId: string;
  title: string;
  subtitle?: string;
  disabled: boolean;
  opening: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const user = useUserProfile(userId);

  return (
    <li>
      <div className="group flex items-stretch hover:bg-accent">
        <ProfileCard user={user} fallbackTitle={title}>
          <button
            type="button"
            className="shrink-0 px-3 py-3"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
          >
            {/* P4.2 local-first:联系人行 uid 在作用域,头像走 useAvatarModel。 */}
            <Avatar
              seed={`u:${userId}`}
              label={title}
              size="md"
              userId={userId}
              remoteUrl={user?.avatar_url}
            />
          </button>
        </ProfileCard>
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            onSelect();
          }}
          disabled={disabled}
          className={cn(
            'flex-1 text-left py-3 pr-4 flex items-start gap-3',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{title}</div>
            {subtitle !== undefined && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {subtitle}
              </div>
            )}
          </div>
          {opening && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {t('contacts.opening')}
            </span>
          )}
        </button>
      </div>
    </li>
  );
}
