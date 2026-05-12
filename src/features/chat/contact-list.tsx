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
// owned here.

import { lazy, Suspense, useState } from 'react';
import { BellRing, UserPlus } from 'lucide-react';
import { useFriendList, useUserProfile } from '@privchat/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLazyMount } from '@/lib/use-lazy-mount';
import { Avatar } from './avatar';
import { ProfileCard } from './profile-card';

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
  onOpen: (user_id: string) => void;
  openingUid: string | null;
  className?: string;
}

export function ContactList({ onOpen, openingUid, className }: ContactListProps) {
  const { t } = useTranslation();
  const friends = useFriendList();
  const [pendingOpen, setPendingOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);

  return (
    <div className={cn('flex h-full flex-col bg-card', className)}>
      <header className="flex shrink-0 items-center justify-end gap-1 border-b px-2 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setPendingOpen(true)}
          aria-label={t('contacts.pending_title')}
          title={t('contacts.pending_title')}
        >
          <BellRing className="h-4 w-4" />
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
                onSelect={() => onOpen(friend.user_id)}
              />
            );
          })}
        </ul>
      </div>

      <LazyContactPendingDialog
        open={pendingOpen}
        onOpenChange={setPendingOpen}
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
            <Avatar seed={`u:${userId}`} label={title} size="md" />
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
