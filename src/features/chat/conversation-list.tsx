// ConversationList — left-rail channel picker. Headless data comes from
// @privchat/react's useChannelList; visual concerns live here. The list
// is the primary entry point on PC; on H5 it's the default screen and
// gets replaced by ConversationPanel when a row is tapped.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, RefreshCcw } from 'lucide-react';
import type { ChannelRecord, UserRecord } from '@privchat/sdk';
import {
  resolveConversationTitle,
  useChannelList,
  useChannelOps,
  useFriendship,
  useGroupProfile,
  useUserProfile,
  type ConversationListItemVM,
  type ConversationTitleI18n,
} from '@privchat/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useConversationTitleI18n } from './use-title-i18n';
import { Avatar } from './avatar';
import { GroupAvatar } from './group-avatar';
import { ProfileCard } from './profile-card';
import { errorText } from './error-text';

export interface ConversationListProps {
  /** Currently-selected channel id (composite "channel_id:channel_type"), if any. */
  activeId?: string | null;
  onSelect: (channelId: string, channelType: number) => void;
  className?: string;
}

export function ConversationList({
  activeId,
  onSelect,
  className,
}: ConversationListProps) {
  const { t } = useTranslation();
  const { conversations: rawConversations, records, isLoading, error, refresh } = useChannelList();
  const titleI18n = useConversationTitleI18n();

  // Local re-sort to keep pinned channels at the top of the list. The
  // SDK already returns `updated_at desc`; we prepend pinned-true rows
  // (preserving their relative order) and append the rest. Hidden rows
  // are filtered out client-side until the next entity-sync removes
  // them server-side. Memoised on the source array.
  //
  // After filter+sort, the conversations array's index no longer aligns
  // with `records[]`. Build a channel_id→record map so each row can
  // look up its source record cleanly.
  const recordByChannelId = useMemo(() => {
    const m = new Map<string, ChannelRecord>();
    for (const r of records) m.set(r.channel_id, r);
    return m;
  }, [records]);
  const conversations = useMemo(() => {
    const visible = rawConversations.filter(
      (c) => recordByChannelId.get(c.channel_id)?.hidden !== true,
    );
    return [...visible].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updated_at - a.updated_at;
    });
  }, [rawConversations, recordByChannelId]);

  // Detect titles that appear on more than one row so we can disambiguate.
  // The SDK's store is keyed strictly on (channel_id, channel_type), so
  // duplicates here mean the SAME title resolved across different channels —
  // commonly when the server returns titles as raw user_id (e.g. "1" for the
  // system account) and that user_id owns several channels (system notice,
  // device events, etc). We show a `· #channel_id` suffix on each duplicate
  // so users can tell them apart.
  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of conversations) {
      counts.set(c.title, (counts.get(c.title) ?? 0) + 1);
    }
    const dup = new Set<string>();
    for (const [title, n] of counts) if (n > 1) dup.add(title);
    return dup;
  }, [conversations]);

  return (
    <div className={cn('flex h-full flex-col bg-card', className)}>
      <header className="flex shrink-0 items-center justify-end border-b px-2 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={isLoading}
          aria-label={t('workspace.refresh')}
          title={t('workspace.refresh')}
        >
          <RefreshCcw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {error !== null && (
          <div className="px-4 py-2 text-xs text-destructive">{error.message}</div>
        )}

        {conversations.length === 0 && !isLoading && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t('workspace.no_conversations')}
          </div>
        )}

        <ul className="divide-y">
          {conversations.map((vm) => {
            const rec = recordByChannelId.get(vm.channel_id);
            if (rec === undefined) return null;
            return (
              <ConversationRow
                key={vm.id}
                vm={vm}
                record={rec}
                titleI18n={titleI18n}
                ambiguous={duplicateTitles.has(vm.title)}
                active={activeId === vm.id}
                onClick={() => onSelect(vm.channel_id, vm.channel_type)}
              />
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ConversationRow({
  vm,
  record,
  titleI18n,
  ambiguous,
  active,
  onClick,
}: {
  vm: ConversationListItemVM;
  record: ChannelRecord;
  titleI18n: ConversationTitleI18n;
  ambiguous: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const { t, i18n } = useTranslation();
  // Direct channels: server emits the peer uid in `ChannelRecord.title`.
  // We look up that uid in the profile cache so the row can show the
  // peer's nickname / username instead of a raw uid. Group channels:
  // pull the GroupRecord by `channel_id` (group_id == channel_id by
  // protocol convention). Direct channels also pick up the friendship
  // row so `alias` (caller's remark name) overrides nickname.
  const isDirect = record.channel_type === 1;
  const peerUid = isDirect ? record.title : undefined;
  const user = useUserProfile(peerUid ?? '');
  const friendship = useFriendship(peerUid ?? '');
  const group = useGroupProfile(record.channel_type === 2 ? record.channel_id : '');
  const titleVm = resolveConversationTitle({
    channel: record,
    user: peerUid !== undefined && peerUid !== '' ? user : undefined,
    peerUid,
    friendship: peerUid !== undefined && peerUid !== '' ? friendship : undefined,
    group: record.channel_type === 2 ? group : undefined,
    i18n: titleI18n,
  });

  // Avatar identity — for direct rows we use the peer user as the
  // identity (so different peers with the same display name still get
  // distinct avatars), for groups we use the channel id, for "system"
  // we render a fixed S.
  const avatarSeed =
    titleVm.kind === 'system'
      ? 'system'
      : isDirect && peerUid !== undefined
        ? `u:${peerUid}`
        : `g:${record.channel_id}`;

  // Preview line: text shows the literal content; every other type shows
  // a locale-specific placeholder ("[图片]" / "[Image]"). Older cached rows
  // without a resolved type fall back to the stored preview string.
  const ct = vm.last_message_content_type;
  // 资金消息兜底：SDK 升级前缓存的行 ct 缺失，preview 是注入的原始 JSON——
  // 绝不把它露在列表里（RP-12 防泄露），按内容嗅探替换占位符。
  const raw = vm.last_message_preview;
  const moneyFallback =
    raw !== undefined && raw.startsWith('{')
      ? raw.includes('"redPacketId"')
        ? t('message_preview.red_packet')
        : raw.includes('"transferId"')
          ? t('message_preview.money_transfer')
          : undefined
      : undefined;
  const previewText =
    ct !== undefined && ct !== 'text'
      ? t(`message_preview.${ct}`)
      : (moneyFallback ?? raw);

  return (
    <li>
      <div
        className={cn(
          'group relative flex items-stretch transition-colors hover:bg-accent',
          active && 'bg-accent',
        )}
      >
        {/* Avatar: opens profile card on click for direct rows. Groups
            don't have a profile card yet so it just selects the row. */}
        <ConversationAvatar
          seed={avatarSeed}
          title={titleVm.title}
          peerUser={isDirect ? user : undefined}
          isDirect={isDirect}
          groupChannelId={record.channel_type === 2 ? record.channel_id : undefined}
          groupAvatarUrl={record.channel_type === 2 ? group?.avatar_url : undefined}
          onSelect={onClick}
        />

        <button
          type="button"
          onClick={onClick}
          className="flex-1 min-w-0 text-left py-3 pr-12 flex items-start justify-between gap-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{titleVm.title}</span>
              {ambiguous && import.meta.env.DEV && (
                <span
                  className="shrink-0 text-[10px] font-mono text-muted-foreground"
                  title={`channel_id=${vm.channel_id} · channel_type=${vm.channel_type}`}
                >
                  #{vm.channel_id}
                </span>
              )}
              {vm.unread_count > 0 && (
                <UnreadBadge count={vm.unread_count} muted={vm.muted} />
              )}
            </div>
            {vm.last_message_revoked ? (
              <div className="mt-0.5 truncate text-xs italic text-muted-foreground">
                {t('channel_actions.revoked_preview')}
              </div>
            ) : (
              previewText !== undefined &&
              previewText !== '' && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {previewText}
                </div>
              )
            )}
          </div>
          <span className="shrink-0 text-[10px] font-mono text-muted-foreground tabular-nums">
            {vm.updated_at > 0 ? formatTimeShort(vm.updated_at, i18n.language) : ''}
          </span>
        </button>

        {/* Actions: pin / mute / hide. Pin and mute toggle based on
            the current ChannelRecord state (R6.c bumped IDB to v7 and
            backfilled defaults), so users see one clear action per
            row. Hide is destructive. Right-edge, hover-revealed. */}
        <ChannelRowActions
          channelId={vm.channel_id}
          pinned={vm.pinned}
          muted={vm.muted}
        />
      </div>
    </li>
  );
}

/** Unread indicator. Two visual modes:
 *
 *   - Normal: red pill with the count (`99+` over 99). The count is
 *     `last_message_pts - read_pts` semantics, computed by the SDK.
 *   - Muted: a tiny grey dot. Muted channels still need *some* visual
 *     to say "there's something here", but should not be pushy —
 *     people mute groups precisely because they don't want red dots
 *     yelling at them. Dot = "yes, unread, but don't bother me."
 *
 *  No icon, no animation; the timeline already moves rows up on activity. */
function UnreadBadge({ count, muted }: { count: number; muted: boolean }) {
  if (muted) {
    return (
      <span
        className="shrink-0 h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
        aria-label={`${count} unread (muted)`}
      />
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-mono text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function ChannelRowActions({
  channelId,
  pinned,
  muted,
}: {
  channelId: string;
  pinned: boolean;
  muted: boolean;
}) {
  const { t } = useTranslation();
  const ops = useChannelOps();
  const { refresh } = useChannelList({ skipAutoBootstrap: true });

  const run = async (fn: () => Promise<unknown>, refreshAfter = false) => {
    try {
      await fn();
      if (refreshAfter) void refresh();
    } catch (e) {
      alert(`${t('channel_actions.failed')}: ${errorText(e)}`);
    }
  };

  return (
    <div
      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-background"
            aria-label="actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => void run(() => ops.pinChannel(channelId, !pinned), true)}
          >
            {pinned ? t('channel_actions.unpin') : t('channel_actions.pin')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void run(() => ops.muteChannel(channelId, !muted), true)}
          >
            {muted ? t('channel_actions.unmute') : t('channel_actions.mute')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => {
              if (!confirm(t('channel_actions.hide_confirm'))) return;
              void run(() => ops.hideChannel(channelId), true);
            }}
          >
            {t('channel_actions.hide')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ConversationAvatar({
  seed,
  title,
  peerUser,
  isDirect,
  groupChannelId,
  groupAvatarUrl,
  onSelect,
}: {
  seed: string;
  title: string;
  peerUser: UserRecord | undefined;
  isDirect: boolean;
  groupChannelId?: string;
  groupAvatarUrl?: string;
  onSelect: () => void;
}) {
  // Group rows currently fall through to the row click; friend/system
  // rows get a profile-card popover. 群行用 GroupAvatar（自定义头像 /
  // 九宫格合成 / 色块兜底三级降级）。
  if (!isDirect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="shrink-0 px-3 py-3"
        aria-label={title}
      >
        {groupChannelId !== undefined ? (
          <GroupAvatar
            channelId={groupChannelId}
            name={title}
            avatarUrl={groupAvatarUrl}
            size="md"
          />
        ) : (
          <Avatar seed={seed} label={title} size="md" />
        )}
      </button>
    );
  }
  return (
    <ProfileCard user={peerUser} fallbackTitle={title}>
      <button
        type="button"
        className="shrink-0 px-3 py-3"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <Avatar seed={seed} label={title} size="md" />
      </button>
    </ProfileCard>
  );
}

function formatTimeShort(ms: number, lang: string): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const zh = lang.startsWith('zh');
  if (sameDay) {
    // 当天：24 小时制。
    return d.toLocaleTimeString(zh ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  // 往日：中文「7月9日」，英文「Jul 9」。
  return zh
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
