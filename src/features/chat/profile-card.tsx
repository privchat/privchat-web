// ProfileCard — small popover summarising a user.
//
// We reuse DropdownMenu instead of building a separate Popover because
// (a) the visual we want — small floating card pinned to a trigger —
// matches DropdownMenu's anchor + portal model, and (b) it avoids
// pulling in another @radix-ui package.
//
// Sections, top to bottom:
//   1. avatar + display name + @username
//   2. presence pill (caller-provided via `presence` prop)
//   3. alias edit row (only when target is a friend, not self)
//   4. destructive actions: 删除好友 / 加入黑名单 (only when not self)
//
// `presence` is passed in pre-fetched (callers that already have a
// usePresence subscription pass it through; ProfileCard doesn't fire
// its own RPC).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, Check, Copy, Loader2, Pencil, X } from 'lucide-react';
import {
  useFriendship,
  usePrivchatClient,
  useRefreshFriendships,
  useRemoveFriend,
  useBlockUser,
  useSetFriendAlias,
} from '@privchat/react';
import type { PresenceStatusItem, UserRecord } from '@privchat/sdk';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAccountCapabilities } from '@/lib/account-capabilities';
import { cn } from '@/lib/utils';
import { Avatar } from './avatar';
import { formatPresenceLine } from './format-last-seen';
import { useLastSeenI18n } from './use-presence-i18n';
import { errorText } from './error-text';
import { ProfileEditDialog } from '@/features/profile/profile-edit-dialog';
import { PrivacySettingsDialog } from '@/features/profile/privacy-settings-dialog';
import { SignInDialog } from '@/features/profile/sign-in-dialog';

export interface ProfileCardProps {
  user: UserRecord | undefined;
  /** Display fallback when `user` hasn't been hydrated yet. */
  fallbackTitle: string;
  presence?: PresenceStatusItem;
  /** The element that opens the card (avatar, name button, etc). */
  children: React.ReactNode;
}

export function ProfileCard({
  user,
  fallbackTitle,
  presence,
  children,
}: ProfileCardProps) {
  const { t } = useTranslation();
  const adapter = usePrivchatClient();
  const i18n = useLastSeenI18n();

  // PROFILE_VISIBILITY:非好友的 username 服务端投影为空串——空值视同缺席,
  // 展示回退 nickname → username → 会话标题,@ 行仅在有值时渲染。
  // user_id 是底层协议标识，任何情况下都不作为展示名（与 App 一致）。
  const display =
    (user?.nickname !== '' ? user?.nickname : undefined) ??
    (user?.username !== '' ? user?.username : undefined) ??
    fallbackTitle;
  const username = user?.username !== '' ? user?.username : undefined;
  const seed = user !== undefined ? `u:${user.user_id}` : `t:${fallbackTitle}`;
  const presenceText = formatPresenceLine(presence, i18n);
  const online = presence?.is_online === true;

  // Self-card has no friend-action surface (can't unfriend / block / alias
  // yourself). R8.4d-1 adds an "Edit profile" affordance for self under
  // capability.profileEdit (PLATFORM only — BUILTIN hides it).
  const selfUid = adapter.sessionSnapshot().user_id;
  const isSelf = user !== undefined && selfUid !== undefined && user.user_id === selfUid;
  const showActions = user !== undefined && !isSelf;
  const capabilities = useAccountCapabilities();
  const showSelfEdit = isSelf && capabilities.profileEdit === true;
  const showSignIn = isSelf && capabilities.memberSignIn === true;
  const [editOpen, setEditOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[260px] p-0">
          <div className="flex items-center gap-3 p-4">
            {/* P4.2 local-first:user 已水合时按 uid 走 useAvatarModel。 */}
            <Avatar
              seed={seed}
              label={display}
              size="lg"
              userId={user?.user_id}
              remoteUrl={user?.avatar_url}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{display}</div>
              {username !== undefined && username !== display && (
                <div className="truncate text-xs text-muted-foreground">
                  @{username}
                </div>
              )}
            </div>
          </div>
          {/* 只展示 username（微信式可分享 ID）。数字 user_id 是底层协议标识，
              不在任何 UI 暴露，也不提供复制入口。 */}
          {user !== undefined && user.username !== '' && (
            <div className="border-t px-4 py-2 space-y-1">
              <CopyRow label={t('copy.username')} value={user.username} />
            </div>
          )}
          {presenceText !== undefined && (
            <div className="flex items-center gap-2 border-t px-4 py-2 text-xs">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  online ? 'bg-emerald-500' : 'bg-muted-foreground/50',
                )}
              />
              <span className={online ? 'text-emerald-600' : 'text-muted-foreground'}>
                {presenceText}
              </span>
            </div>
          )}
          {user === undefined && presenceText === undefined && (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              {t('app.loading')}
            </div>
          )}
          {isSelf && (
            <button
              type="button"
              onClick={() => setPrivacyOpen(true)}
              className="flex w-full items-center justify-center gap-2 border-t px-3 py-2 text-xs hover:bg-accent"
              data-testid="profile-card-privacy-self"
            >
              {t('privacy.open_button')}
            </button>
          )}
          {showSelfEdit && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="flex w-full items-center justify-center gap-2 border-t px-3 py-2 text-xs hover:bg-accent"
              data-testid="profile-card-edit-self"
            >
              <Pencil className="h-3 w-3" />
              {t('profile_edit.open_button')}
            </button>
          )}
          {showSignIn && (
            <button
              type="button"
              onClick={() => setSignInOpen(true)}
              className="flex w-full items-center justify-center gap-2 border-t px-3 py-2 text-xs hover:bg-accent"
              data-testid="profile-card-sign-in"
            >
              <CalendarCheck className="h-3 w-3" />
              {t('sign_in.open_button')}
            </button>
          )}
          {showActions && <ProfileCardActions user={user} display={display} />}
        </DropdownMenuContent>
      </DropdownMenu>
      {showSelfEdit && (
        <ProfileEditDialog open={editOpen} onOpenChange={setEditOpen} />
      )}
      {isSelf && (
        <PrivacySettingsDialog open={privacyOpen} onOpenChange={setPrivacyOpen} />
      )}
      {showSignIn && (
        <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
      )}
    </>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="truncate font-mono">{value}</span>
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
        title={copied ? t('copy.copied') : t('copy.label')}
        aria-label={t('copy.label')}
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-600" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}

function ProfileCardActions({
  user,
  display,
}: {
  user: UserRecord;
  display: string;
}) {
  const { t } = useTranslation();
  const friendship = useFriendship(user.user_id);
  const setAlias = useSetFriendAlias();
  const removeFriend = useRemoveFriend();
  const blockUser = useBlockUser();
  const refreshFriendships = useRefreshFriendships();

  const isFriend = friendship !== undefined;
  // Local input state; seeded from friendship.alias and resynced when
  // the friendship row updates (poll / accept / external edit).
  const [aliasDraft, setAliasDraft] = useState(friendship?.alias ?? '');
  useEffect(() => {
    setAliasDraft(friendship?.alias ?? '');
  }, [friendship?.alias]);

  const [savingAlias, setSavingAlias] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aliasChanged = (friendship?.alias ?? '') !== aliasDraft.trim();
  const aliasHasValue = aliasDraft.trim() !== '';

  const onSaveAlias = async () => {
    if (savingAlias) return;
    setSavingAlias(true);
    setError(null);
    try {
      await setAlias(user.user_id, aliasDraft.trim());
      // Pull the canonical alias back so the row is in sync immediately.
      void refreshFriendships();
    } catch (e) {
      setError(`${t('contacts.alias_failed')}: ${errorText(e)}`);
    } finally {
      setSavingAlias(false);
    }
  };

  const onClearAlias = async () => {
    if (savingAlias) return;
    setSavingAlias(true);
    setError(null);
    try {
      await setAlias(user.user_id, '');
      setAliasDraft('');
      void refreshFriendships();
    } catch (e) {
      setError(`${t('contacts.alias_failed')}: ${errorText(e)}`);
    } finally {
      setSavingAlias(false);
    }
  };

  const onRemoveFriend = async () => {
    if (removing) return;
    if (!confirm(t('contacts.remove_friend_confirm', { name: display }))) return;
    setRemoving(true);
    setError(null);
    try {
      await removeFriend(user.user_id);
      void refreshFriendships();
    } catch (e) {
      setError(`${t('contacts.remove_friend_failed')}: ${errorText(e)}`);
    } finally {
      setRemoving(false);
    }
  };

  const onBlock = async () => {
    if (blocking) return;
    if (!confirm(t('contacts.block_confirm', { name: display }))) return;
    setBlocking(true);
    setError(null);
    try {
      await blockUser(user.user_id);
      // Blocking typically also unfriends server-side; refresh to drop
      // the row from the local list.
      void refreshFriendships();
    } catch (e) {
      setError(`${t('contacts.block_failed')}: ${errorText(e)}`);
    } finally {
      setBlocking(false);
    }
  };

  return (
    <>
      {isFriend && (
        <div className="border-t px-4 py-2 space-y-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('contacts.alias_label')}
          </label>
          <div className="flex gap-1">
            <Input
              value={aliasDraft}
              onChange={(e) => setAliasDraft(e.currentTarget.value)}
              placeholder={t('contacts.alias_placeholder')}
              className="h-8 text-xs"
              disabled={savingAlias}
            />
            {aliasChanged && aliasHasValue && (
              <Button
                size="sm"
                onClick={() => void onSaveAlias()}
                disabled={savingAlias}
                className="h-8 px-2"
              >
                {savingAlias ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  t('contacts.alias_save')
                )}
              </Button>
            )}
            {!aliasChanged && (friendship?.alias ?? '') !== '' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void onClearAlias()}
                disabled={savingAlias}
                className="h-8 px-2"
                title={t('contacts.alias_clear')}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      )}
      {error !== null && (
        <div className="border-t px-4 py-2 text-[11px] text-destructive">
          {error}
        </div>
      )}
      <div className="flex border-t">
        {isFriend && (
          <button
            type="button"
            onClick={() => void onRemoveFriend()}
            disabled={removing}
            className="flex-1 px-3 py-2 text-xs text-destructive hover:bg-accent disabled:opacity-50"
          >
            {removing ? (
              <Loader2 className="h-3 w-3 animate-spin mx-auto" />
            ) : (
              t('contacts.remove_friend')
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => void onBlock()}
          disabled={blocking}
          className={cn(
            'flex-1 px-3 py-2 text-xs hover:bg-accent disabled:opacity-50',
            isFriend && 'border-l',
          )}
        >
          {blocking ? (
            <Loader2 className="h-3 w-3 animate-spin mx-auto" />
          ) : (
            t('contacts.block')
          )}
        </button>
      </div>
    </>
  );
}
