// ConversationPanel — first-class headless-friendly chat surface.
//
// This component is the architectural commitment from R1: a single,
// self-contained conversation view that works in any context where the host
// already knows (channelId, channelType) — Telegram-style apps, customer
// support widgets, in-game chat, robot dialogs, etc. It does NOT depend on a
// channel list. Mounting it auto-opens the channel and wires the composer.
//
// Visual concerns (timeline rendering, virtualization, theming) live here in
// the web app — `@privchat/react` only ships hooks/VMs.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift, ImageIcon, Info, Paperclip, X as XIcon } from 'lucide-react';
import {
  resolveConversationTitle,
  useChannelList,
  useConversation,
  useFriendship,
  useGroupOps,
  useGroupProfile,
  usePresence,
  usePrivchatClient,
  useTyping,
  useUserProfile,
  useJumpToMessage,
} from '@privchat/react';
import type { MessageItemVM } from '@privchat/react';
import type { PinnedMessageItem } from '@privchat/sdk';
import { stopAll as stopVoicePlayback } from './voice-playback';
import { projectEntry, removeEntry } from './media-send-store';
import { useChannelMediaSends, useMediaSender } from './use-media-send';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConversationTitleI18n } from './use-title-i18n';
import { ProfileCard } from './profile-card';
import { formatPresenceLine } from './format-last-seen';
import { useLastSeenI18n } from './use-presence-i18n';
import { useLazyMount } from '@/lib/use-lazy-mount';
import { MessageList } from './message-list';
import { ForwardDialog } from './forward-dialog';
import { BotMenuButton } from './bot-menu-button';
import { PinnedBar } from './pinned-bar';
import { useMoneyUi } from '@/features/money/money-ui';
import { RedPacketLiveStatusContext, MoneyPeerNameContext } from '@/features/money/money-card';
import { getConfiguredAccountMode } from '@/lib/account-mode';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Lazy-loaded — group info pulls roster data + admin actions, none
// of which is on the first-paint path. Only opens when the user
// taps the (i) button or the group title in the panel header.
const GroupInfoDialog = lazy(() =>
  import('./group-info-dialog').then((m) => ({
    default: m.GroupInfoDialog,
  })),
);

export interface ConversationPanelProps {
  channelId: string;
  channelType: number;
  /** Optional title for the panel header. */
  title?: string;
  /** 新建 DM record 未同步时的对端 uid 兜底(chat-workspace 从联系人打开时传)。 */
  peerUidHint?: string;
  /**
   * Optional back-navigation handler. When provided, a back button renders
   * in the panel header. Web layout uses this for H5's single-pane mode
   * to return to the list; PC layout omits it (keeps list always visible).
   */
  onBack?: () => void;
  /** 搜索命中跳转锚（server_message_id）：mount 后回灌上下文并定位高亮（spec §5）。 */
  jumpToMessageId?: string;
  className?: string;
}

export function ConversationPanel({
  channelId,
  channelType,
  title,
  peerUidHint,
  jumpToMessageId,
  onBack,
  className,
}: ConversationPanelProps) {
  const { t } = useTranslation();
  const titleI18n = useConversationTitleI18n();
  const {
    messages,
    pendingCount,
    reachedBeginning,
    isOpening,
    error,
    peerReadPts,
    loadOlder,
    send,
  } = useConversation(channelId, channelType);

  // 群会话打开时拉一次成员列表 —— SDK 的 groupMemberList 会把成员 profile 灌进用户缓存
  // (ingestUserProfiles 单写路径),使点击非好友/未同步成员的头像时资料能解析出来,
  // 修 ProfileCard 卡「加载中」。best-effort,失败不影响会话。
  const hydrationAdapter = usePrivchatClient();
  useEffect(() => {
    if (channelType !== 2) return;
    void hydrationAdapter.listGroupMembers(channelId).catch(() => {
      /* best-effort profile hydration */
    });
  }, [hydrationAdapter, channelId, channelType]);

  // spec §5 jump-to-message：搜索命中打开会话后，先经 jumpToMessageContext 回灌
  // 本地缓存（IndexedDB + 内存 buffer，useConversation 的 messages 流随之更新），
  // 再把锚交给 MessageList 定位高亮。锚不可见（撤回/删除/越权 not_found）提示失效。
  const jumpTo = useJumpToMessage();
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [jumpFailed, setJumpFailed] = useState(false);
  useEffect(() => {
    if (jumpToMessageId === undefined) return;
    let cancelled = false;
    jumpTo(channelId, channelType, jumpToMessageId)
      .then(() => {
        if (!cancelled) setFocusMessageId(jumpToMessageId);
      })
      .catch(() => {
        if (!cancelled) setJumpFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // channelId/channelType 由 key 重挂保证稳定；仅 anchor 驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToMessageId]);

  // Look up the underlying ChannelRecord so the resolver has the full
  // shape it needs (peer uid for direct, group_id for group). The
  // channel-list hook already keeps this snapshot live + sorted.
  const { records } = useChannelList({ skipAutoBootstrap: true });
  const record = useMemo(
    () =>
      records.find(
        (r) => r.channel_id === channelId && r.channel_type === channelType,
      ),
    [records, channelId, channelType],
  );
  const peerUid =
    (record?.channel_type === 1
      ? (record.peer_user_id ?? record.title)
      : undefined) ?? peerUidHint;
  const userProfile = useUserProfile(peerUid ?? '');
  // BOT_INTERACTION_SPEC §3.1：DM 对端 user_type=2 (Bot) 时显示菜单按钮。
  // System (user_type=1) v1 不显示（系统用户没有 bot service binding）。
  const isBot = record?.channel_type === 1 && userProfile?.user_type === 2;
  const friendship = useFriendship(peerUid ?? '');
  const groupProfile = useGroupProfile(
    record?.channel_type === 2 ? record.channel_id : '',
  );
  const resolvedTitle = useMemo(() => {
    if (record === undefined) return undefined;
    return resolveConversationTitle({
      channel: record,
      user:
        peerUid !== undefined && peerUid !== '' ? userProfile : undefined,
      peerUid,
      friendship:
        peerUid !== undefined && peerUid !== '' ? friendship : undefined,
      group: record.channel_type === 2 ? groupProfile : undefined,
      i18n: titleI18n,
    });
  }, [record, userProfile, friendship, groupProfile, peerUid, titleI18n]);
  // Once the canonical channel/friendship records are available they own the
  // display name. `title` is only a first-open hint while entity sync catches up.
  const headerTitle = resolvedTitle?.title ?? title ?? channelId;
  const isDirect = record?.channel_type === 1;
  // 群标题带人数「名称 (N)」；member_count 是 best-effort 缓存，>0 才显示。
  const groupMemberCount =
    record?.channel_type === 2 ? (groupProfile?.member_count ?? 0) : 0;
  // Pull presence for direct chats; the header subtitle and the
  // profile-card popover share this single fetch.
  const presence = usePresence(isDirect ? peerUid : undefined);
  const lastSeenI18n = useLastSeenI18n();
  const presenceLine = formatPresenceLine(presence, lastSeenI18n);
  // Typing: subscribes to the channel on mount and listens for inbound
  // typing pushes. When peer is typing we override the subtitle line.
  const { isPeerTyping, notify: notifyTyping } = useTyping(channelId, channelType);
  const subtitleLine = isPeerTyping ? t('panel.peer_typing') : presenceLine;

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [dragHover, setDragHover] = useState(false);
  // Reply target — set by clicking "Reply" in a row's menu, cleared
  // by sending or by the X in the composer header.
  const [replyTo, setReplyTo] = useState<MessageItemVM | null>(null);
  const [forwardSource, setForwardSource] = useState<MessageItemVM | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 发送后 draft 清空时,把自增高的输入框高度收回单行。
  useEffect(() => {
    if (draft === '' && inputRef.current) inputRef.current.style.height = 'auto';
  }, [draft]);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const filePickerRef = useRef<HTMLInputElement | null>(null);

  const mediaSender = useMediaSender();
  const mediaSends = useChannelMediaSends(channelId);
  const selfUid = usePrivchatClient().sessionSnapshot().user_id;

  // ---- group message pinning ----
  //
  // Group-only. We resolve `isManager` (owner/admin) from the roster and
  // keep the pinned-message list in local state (refreshed after every
  // pin/unpin). Direct chats skip all of this — the effects below bail
  // out when `record` isn't a group, and the props stay undefined so the
  // timeline / menu never show pin affordances.
  const groupOps = useGroupOps();
  const groupId = record?.channel_type === 2 ? record.channel_id : undefined;
  const [isManager, setIsManager] = useState(false);
  // uid → role ('owner'/'admin'/'member'):驱动气泡昵称旁的【群主】/【管理】标签。
  const [roleByUid, setRoleByUid] = useState<Map<string, string>>(new Map());
  const [pinnedItems, setPinnedItems] = useState<PinnedMessageItem[]>([]);

  // 权限与角色标签都走 group/info 的**有界**字段：`my_role` 判断我能不能管理，
  // `owner_id` + `admin_user_ids` 给气泡打【群主】/【管理】标签。
  //
  // 这里原本拉整份花名册（listMembers）再在里面找自己——一个 750 人的群 126 KB、
  // 服务端约 1s，只为回答「我是不是管理员」和几个发言人的名字。发言人昵称由
  // 本地 user store 提供（SenderNameLabel 已有该回落），群名片 alias 目前
  // 全站为空且无任何端可设置。见 CHANNEL_SPEC §9.2.2。失败时降级为只读。
  useEffect(() => {
    if (groupId === undefined) {
      setIsManager(false);
      setRoleByUid(new Map());
      return;
    }
    let cancelled = false;
    void groupOps
      .groupInfo(groupId)
      .then((resp) => {
        if (cancelled) return;
        const info = resp.group_info;
        const myRole = info.my_role ?? '';
        setIsManager(myRole === 'owner' || myRole === 'admin');
        const roles = new Map<string, string>();
        if (info.owner_id !== undefined) roles.set(String(info.owner_id), 'owner');
        for (const uid of info.admin_user_ids ?? []) roles.set(String(uid), 'admin');
        setRoleByUid(roles);
      })
      .catch(() => {
        if (!cancelled) setIsManager(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, groupOps]);

  // Refreshable pinned-message list. Wrapped so both the initial load
  // effect and the pin/unpin toggle can re-pull and keep the bar + the
  // row-menu labels in sync.
  const refreshPinned = useCallback(async () => {
    if (groupId === undefined) {
      setPinnedItems([]);
      return;
    }
    try {
      const resp = await groupOps.pinnedMessages(groupId);
      setPinnedItems(resp.items);
    } catch {
      // Non-fatal: leave the last-known list; a later toggle retries.
    }
  }, [groupId, groupOps]);

  useEffect(() => {
    void refreshPinned();
  }, [refreshPinned]);

  const pinnedIds = useMemo(
    () => new Set(pinnedItems.map((i) => String(i.message_id))),
    [pinnedItems],
  );

  const onTogglePin = useCallback(
    async (vm: MessageItemVM) => {
      if (groupId === undefined || vm.server_message_id === undefined) return;
      const alreadyPinned = pinnedIds.has(vm.server_message_id);
      // Group invariant: channel_id == group_id, so we pass groupId twice.
      await groupOps.pinMessage(
        groupId,
        groupId,
        vm.server_message_id,
        !alreadyPinned,
      );
      await refreshPinned();
    },
    [groupId, groupOps, pinnedIds, refreshPinned],
  );

  const onUnpinFromBar = useCallback(
    async (messageId: string) => {
      if (groupId === undefined) return;
      await groupOps.pinMessage(groupId, groupId, messageId, false);
      await refreshPinned();
    },
    [groupId, groupOps, refreshPinned],
  );

  // Voice playback is a single-active controller across the whole app.
  // When the user navigates to a different conversation (channelId
  // changes) or unmounts this panel, hard-stop whatever was playing
  // — otherwise audio keeps going from the previous chat.
  useEffect(() => {
    return () => {
      stopVoicePlayback();
    };
  }, [channelId]);

  const onSend = async () => {
    const text = draft.trim();
    if (text === '' || sending) return;
    setSending(true);
    try {
      await send(text, {
        reply_to_message_id: replyTo?.server_message_id,
      });
      setDraft('');
      setReplyTo(null);
      // Send stop-typing immediately so peer's "正在输入…" clears the
      // moment our message lands, not after the idle timeout.
      notifyTyping('');
    } catch {
      // error is surfaced via `useConversation().error`
    } finally {
      setSending(false);
      // Re-focus the composer so the next message can be typed without
      // reaching for the mouse — Enter-send + immediate refocus is the
      // standard chat-app idiom. We schedule via rAF so the focus call
      // runs AFTER React re-enables the input (the `disabled={sending}`
      // flip would otherwise blur an active focus).
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  };

  // Send a canned message from a bot-menu `message` action through the
  // same path as user-typed text (timeline / ack / reply identical).
  // metadata 暂时只透传名字——SDK 现有 `send()` 签名没暴露 metadata 字段，
  // 等 send-message-request metadata wiring 落地再补；v1 先吃文本即可。
  const sendBotMenuMessage = async (
    text: string,
    _metadata?: Record<string, unknown>,
  ) => {
    const t = text.trim();
    if (t === '' || sending) return;
    setSending(true);
    try {
      await send(t, {
        reply_to_message_id: replyTo?.server_message_id,
      });
      setReplyTo(null);
      notifyTyping('');
    } catch {
      // error surfaces via useConversation().error
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  };

  // ---- media upload + send ----
  //
  // Selecting media immediately inserts an optimistic bubble into the
  // timeline (media-send-store entry, projected below into the messages
  // array). Upload failures surface ON the bubble with retry/dismiss —
  // the Blob stays in memory so retry re-runs upload+send. Once the
  // upload succeeds, the SDK's own optimistic row (same txnId as
  // local_message_id) takes over and the hand-off effect drops the
  // overlay entry; post-upload SEND failures are owned by the existing
  // outbox failed/retry UI. In-session only by design (refresh drops
  // failed media; the user re-selects the file).
  const onSendImageBlob = async (file: Blob, filename: string, mime: string) => {
    const dims = await readImageDimensions(file).catch(() => ({ width: 0, height: 0 }));
    await mediaSender.send({
      channelId,
      channelType,
      fromUid: selfUid ?? '',
      kind: 'image',
      file,
      filename,
      mime,
      width: dims.width,
      height: dims.height,
    });
  };

  const onSendFileBlob = async (file: Blob, filename: string, mime: string) => {
    await mediaSender.send({
      channelId,
      channelType,
      fromUid: selfUid ?? '',
      kind: 'file',
      file,
      filename,
      mime,
    });
  };

  const onSendVideoBlob = async (file: Blob, filename: string, mime: string) => {
    // Best-effort metadata probe via a hidden <video> element. If it
    // fails (codec the browser can't decode, broken file), we fall
    // back to width/height/duration = 0 — the server still accepts
    // the message; the receiver just renders a player with default
    // dims and no duration overlay.
    const meta = await readVideoMetadata(file).catch(() => ({
      width: 0,
      height: 0,
      duration: 0,
    }));
    await mediaSender.send({
      channelId,
      channelType,
      fromUid: selfUid ?? '',
      kind: 'video',
      file,
      filename,
      mime,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
    });
  };

  /** Multi-file dispatcher used by both file pickers and the
   *  drag/paste handlers. Routes image / video / generic-file by MIME. */
  const onAttachFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) {
        await onSendImageBlob(f, f.name || 'image', f.type || 'image/jpeg');
      } else if (f.type.startsWith('video/')) {
        await onSendVideoBlob(f, f.name || 'video', f.type || 'video/mp4');
      } else {
        await onSendFileBlob(f, f.name || 'file', f.type || 'application/octet-stream');
      }
    }
  };

  // Merge in-flight media uploads as synthetic bubbles. Pending sends are
  // newest, so timestamp-sort puts them at the bottom. Once the SDK's own
  // optimistic row lands (same local_message_id as txnId), the hand-off
  // effect below removes the entry, so there is never a duplicate.
  const timelineMessages = useMemo(() => {
    if (mediaSends.length === 0) return messages;
    return [...messages, ...mediaSends.map(projectEntry)].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }, [messages, mediaSends]);

  // 红包实时状态（App redPacketStatusOf 对齐）：扫会话系统消息，
  // 「抢完/过期」→2；「领取」且 user ref 是自己 →1。卡片据此覆盖注入快照。
  const rpLiveStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of timelineMessages) {
      if (m.content_type !== 'system') continue;
      if (m.body.kind !== 'system' || m.body.template === undefined) continue;
      const rp = m.body.refs.find((r) => r.type === 'red_packet');
      if (rp?.target_id === undefined) continue;
      if (m.body.template.includes('抢完') || m.body.template.includes('过期')) {
        map.set(rp.target_id, 2);
      } else if (m.body.template.includes('领取')) {
        const u = m.body.refs.find((r) => r.type === 'user');
        if (u?.target_id === selfUid) map.set(rp.target_id, 1);
      }
    }
    return map;
  }, [timelineMessages, selfUid]);

  // 红包/转账入口 PLATFORM-only（对齐 App/H5 gating）；转账仅单聊。
  const moneyUi = useMoneyUi();
  const isPlatform = getConfiguredAccountMode() === 'platform';

  // Hand-off: drop the overlay entry once the real cache row exists.
  useEffect(() => {
    if (mediaSends.length === 0) return;
    const realIds = new Set(
      messages
        .map((m) => m.local_message_id)
        .filter((id): id is string => id !== undefined),
    );
    for (const e of mediaSends) {
      if (realIds.has(e.txnId)) removeEntry(e.txnId);
    }
  }, [messages, mediaSends]);

  const onLoadOlder = async () => {
    if (loadingOlder || reachedBeginning) return;
    setLoadingOlder(true);
    try {
      await loadOlder();
    } catch {
      /* surfaced via error */
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <RedPacketLiveStatusContext.Provider value={rpLiveStatus}>
    <MoneyPeerNameContext.Provider value={isDirect ? headerTitle : undefined}>
    <div
      className={cn(
        // No default border/rounded — visual chrome is the consumer's job.
        // ChatWorkspace uses the panel as the right pane (no extra frame
        // needed); embed scenarios wrap with their own <Card> if desired.
        // h-full requires the parent to constrain height (flex-1 + min-h-0).
        'relative flex h-full flex-col overflow-hidden bg-card',
        className,
      )}
      onDragOver={(e) => {
        // Block default browser file-drop (which navigates) and arm the
        // visual hint. dropEffect must be set in onDragOver, not onDragEnter.
        e.preventDefault();
        if (!dragHover) setDragHover(true);
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the panel itself, not when crossing
        // into a child element.
        if (e.currentTarget === e.target) setDragHover(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragHover(false);
        if (e.dataTransfer.files.length > 0) {
          void onAttachFiles(e.dataTransfer.files);
        }
      }}
    >
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {onBack !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onBack}
              aria-label={t('panel.back')}
              // Hidden on md+ where the list is always visible; only the
              // single-pane H5 layout actually needs the back affordance.
              className="md:hidden -ml-2"
            >
              ←
            </Button>
          )}
          {isDirect ? (
            <ProfileCard
              user={userProfile}
              fallbackTitle={headerTitle}
              presence={presence}
            >
              <button
                type="button"
                className="flex min-w-0 flex-col items-start text-left rounded-md px-1 -mx-1 hover:bg-accent/50"
              >
                <span className="truncate text-sm font-semibold">
                  {headerTitle}
                </span>
                {subtitleLine !== undefined && (
                  <span
                    className={cn(
                      'truncate text-[11px]',
                      isPeerTyping
                        ? 'text-primary'
                        : presence?.is_online === true
                          ? 'text-emerald-600'
                          : 'text-muted-foreground',
                    )}
                  >
                    {subtitleLine}
                  </span>
                )}
              </button>
            </ProfileCard>
          ) : (
            <button
              type="button"
              className="flex min-w-0 flex-col items-start text-left rounded-md px-1 -mx-1 hover:bg-accent/50"
              onClick={() => setGroupInfoOpen(true)}
            >
              <span className="truncate text-sm font-semibold">
                {groupMemberCount > 0
                  ? `${headerTitle} (${groupMemberCount})`
                  : headerTitle}
              </span>
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {isOpening && <span>{t('panel.opening')}</span>}
          {pendingCount > 0 && <span>{t('panel.pending_count', { count: pendingCount })}</span>}
          {!isDirect && record !== undefined && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setGroupInfoOpen(true)}
              aria-label={t('groups.info_button')}
              title={t('groups.info_button')}
            >
              <Info className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      {!isDirect && groupId !== undefined && (
        <PinnedBar
          items={pinnedItems}
          messages={timelineMessages}
          canManage={isManager}
          onUnpin={onUnpinFromBar}
        />
      )}

      {jumpFailed && (
        <div className="px-4 py-1 text-center text-xs text-muted-foreground">
          {t('workspace.msg_search_jump_failed')}
        </div>
      )}
      <MessageList
        messages={timelineMessages}
        focusMessageId={focusMessageId ?? undefined}
        onFocusConsumed={() => setFocusMessageId(null)}
        channelId={channelId}
        selfUid={selfUid}
        peerReadPts={peerReadPts}
        peerName={isDirect ? headerTitle : undefined}
        isOpening={isOpening}
        reachedBeginning={reachedBeginning}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        onReply={(m) => setReplyTo(m)}
        onForward={(m) => setForwardSource(m)}
        isGroup={!isDirect}
        canPin={!isDirect && groupId !== undefined ? isManager : undefined}
        canRevokeOthers={!isDirect && groupId !== undefined ? isManager : undefined}
        roleByUid={!isDirect && groupId !== undefined ? roleByUid : undefined}
        pinnedIds={!isDirect && groupId !== undefined ? pinnedIds : undefined}
        onTogglePin={
          !isDirect && groupId !== undefined ? onTogglePin : undefined
        }
      />

      <ForwardDialog
        source={forwardSource}
        sourceChannelId={channelId}
        sourceChannelType={isDirect ? 1 : 2}
        onClose={() => setForwardSource(null)}
      />

      {error !== null && (
        <div className="shrink-0 border-t px-4 py-2 text-xs text-destructive">
          {error.message}
        </div>
      )}
      {dragHover && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary text-sm font-medium text-primary pointer-events-none">
          {t('panel.drop_to_upload')}
        </div>
      )}

      {!isDirect && record !== undefined && (
        <LazyGroupInfoDialog
          open={groupInfoOpen}
          onOpenChange={setGroupInfoOpen}
          groupId={record.channel_id}
          title={headerTitle}
          onLeft={onBack}
        />
      )}

      {replyTo !== null && (
        <div className="shrink-0 border-t bg-muted/30 px-3 py-1.5 flex items-center gap-2 text-xs">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('message_actions.replying_to')}
            </div>
            <div className="truncate text-muted-foreground">
              {replyTo.body.text !== ''
                ? replyTo.body.text
                : `[${replyTo.content_type}]`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="shrink-0 rounded p-1 hover:bg-accent"
            aria-label={t('message_actions.cancel_reply')}
            title={t('message_actions.cancel_reply')}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <footer className="shrink-0 border-t p-3 flex items-center gap-2">
        <input
          ref={imagePickerRef}
          type="file"
          // The "image" picker button accepts both images and videos —
          // `onAttachFiles` routes each by MIME type to the right
          // sender. Visually we keep it labelled as the image button
          // (camera icon) since "图片/视频" is the standard chat-app
          // grouping (Telegram, WeChat, WhatsApp all do this).
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const fs = e.currentTarget.files;
            if (fs !== null && fs.length > 0) void onAttachFiles(fs);
            e.currentTarget.value = '';
          }}
        />
        <input
          ref={filePickerRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const fs = e.currentTarget.files;
            if (fs !== null && fs.length > 0) void onAttachFiles(fs);
            e.currentTarget.value = '';
          }}
        />
        {isBot && (
          <BotMenuButton
            channelId={channelId}
            onError={(msg) => {
              // 简单 toast：直接 alert 也行，但避免阻塞；这里 console + 屏幕上不展示
              // 沉默错误（菜单失败不该打断对话），用户重新点会再次拉取。
              console.warn('[bot-menu]', msg);
            }}
            onSendMessage={(text, metadata) => {
              void sendBotMenuMessage(text, metadata);
            }}
          />
        )}
        {isPlatform && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('money.entry.red_packet')} data-testid="composer-money-menu">
                <Gift className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem
                onSelect={() => moneyUi.open({ type: 'rp-send', channelId, channelType })}
              >
                🧧 {t('money.entry.red_packet')}
              </DropdownMenuItem>
              {isDirect && peerUid !== undefined && peerUid !== '' && (
                <DropdownMenuItem
                  onSelect={() =>
                    moneyUi.open({ type: 'tf-send', channelId, toUserId: peerUid, toName: headerTitle })
                  }
                >
                  💸 {t('money.entry.transfer')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => imagePickerRef.current?.click()}
          aria-label={t('panel.upload_image')}
          title={t('panel.upload_image')}
        >
          <ImageIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => filePickerRef.current?.click()}
          aria-label={t('panel.upload_file')}
          title={t('panel.upload_file')}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <textarea
          ref={inputRef}
          autoFocus
          rows={1}
          value={draft}
          className="flex max-h-40 min-h-10 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(e) => {
            const el = e.currentTarget;
            const v = el.value;
            setDraft(v);
            notifyTyping(v);
            // 自增高:随内容行数长高,封顶后内部滚动。
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            // Enter 发送；Shift+Enter 插入换行（多行消息）。输入法组合中(isComposing)不拦截。
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void onSend();
            }
          }}
          onPaste={(e) => {
            // Pasted image from clipboard → upload as image. Skip if
            // the paste is text only (let the default text-paste run).
            const items = e.clipboardData.items;
            const files: File[] = [];
            for (let i = 0; i < items.length; i++) {
              const it = items[i];
              if (it && it.kind === 'file') {
                const f = it.getAsFile();
                if (f !== null) files.push(f);
              }
            }
            if (files.length > 0) {
              e.preventDefault();
              void onAttachFiles(files);
            }
          }}
          placeholder={t('panel.type_message')}
          disabled={sending}
        />
        <Button onClick={onSend} disabled={sending || draft.trim() === ''}>
          {sending ? t('panel.sending') : t('panel.send')}
        </Button>
      </footer>
    </div>
    </MoneyPeerNameContext.Provider>
    </RedPacketLiveStatusContext.Provider>
  );
}

/** Lazy wrapper for `GroupInfoDialog`. Mounts on first open and stays
 *  mounted afterwards so the Radix close-state animation can play. */
function LazyGroupInfoDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  title: string;
  onLeft?: () => void;
}) {
  const mounted = useLazyMount(props.open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <GroupInfoDialog {...props} />
    </Suspense>
  );
}


/** Probe an image blob for its natural dimensions in the browser
 *  using `createImageBitmap` (decodes via the GPU when available),
 *  falling back to an Image object for older browsers. Used by the
 *  upload flow so the receiver can render the bubble at the right
 *  aspect ratio without waiting for the network image to load. */
async function readImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bmp = await createImageBitmap(file);
      const dims = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      return dims;
    } catch {
      // fall through to <img> path
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image probe failed'));
    };
    img.src = url;
  });
}

/** Probe a video blob for `videoWidth` / `videoHeight` / `duration`
 *  using a detached `<video>` element. Loads metadata only — never
 *  fetches the body. Rejects on decode error / unknown codec; callers
 *  fall back to `0/0/0` and let the receiver render default chrome. */
async function readVideoMetadata(
  file: Blob,
): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.src = '';
    };
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      // Some browsers report duration as Infinity for streamed / chunked
      // sources before a seek; treat that as "unknown" rather than
      // poisoning the receiver with a bogus value.
      const rawDuration = video.duration;
      const duration =
        Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
      cleanup();
      resolve({ width, height, duration });
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('video probe failed'));
    };
    video.src = url;
  });
}
