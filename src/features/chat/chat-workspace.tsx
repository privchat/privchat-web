// ChatWorkspace — post-authenticate shell with PC/H5 responsive layout.
//
// Layout contract:
//   - md+: persistent two-pane. Left aside (320px fixed) hosts a tab strip
//     (Chats / Contacts / Groups) plus the matching list; right pane is
//     the active ConversationPanel (flex-1).
//   - <md: single-pane. Default = aside (with tabs). Selecting a row
//     swaps to panel; panel's back button restores the list.
//
// Height plumbing (the part you have to get right or composer disappears
// and the timeline can't scroll):
//
//   <root>      h-dvh + flex-col           (anchors viewport height)
//   <topbar>    auto height
//   <split>     flex-1 + min-h-0           (KEY: min-h-0 stops the default
//               + flex md:flex-row          flex item min-height: auto from
//                                           expanding past the viewport)
//   <aside>     flex-col + min-h-0         (so its scroll region works)
//                + md:w-[320px] md:shrink-0
//   <main>      flex-1 + min-h-0 + flex-col (so the panel inside, which is
//                                            also flex-col with flex-1 timeline,
//                                            actually gets a bounded track)
//
// Drop ANY of the `min-h-0`s and the timeline overflow-auto stops scrolling
// (because flex children default to min-height: auto, which expands to fit
// content and defeats overflow). This is the canonical chat-app gotcha.
//
// `@privchat/react` does not handle responsiveness — host concern.

import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  BellOff,
  FileText,
  LogOut,
  QrCode,
  ScanLine,
  Volume2,
  VolumeX,
  Ticket,
  Wallet,
} from 'lucide-react';
import {
  useChannelList,
  useOpenDirectConversation,
  usePrivchatClient,
  useRuntimeBanner,
  useUserProfile,
} from '@privchat/react';
import type { PrivchatHandle } from '@/lib/privchat-client';
import type { AccountKey } from '@/lib/account-key';
import type { SwitchError } from '@/App';
import { AccountSwitcher } from '@/features/auth/account-switcher';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LangSwitcher } from '@/components/lang-switcher';
import { ConversationList } from './conversation-list';
import { MessageSearchDialog } from './message-search-dialog';
import { ConversationPanel } from './conversation-panel';
import { ContactList } from './contact-list';
import { GroupList } from './group-list';
import { SidebarTabs, type SidebarTab } from './sidebar-tabs';
import { Avatar } from './avatar';
import { ProfileCard } from './profile-card';
import { useMoneyUi } from '@/features/money/money-ui';
import { InviteBindDialog } from '@/features/profile/invite-bind-dialog';
import { getConfiguredAccountMode } from '@/lib/account-mode';
import { brandConfig } from '@/lib/brand-config';
import { useTabBadge } from './use-tab-badge';
import { useIncomingNotifier, type IncomingNotifier } from './use-incoming-notifier';
import { QrcodeDisplayDialog } from './qrcode-display-dialog';
import { QrcodeScanDialog } from './qrcode-scan-dialog';
import { captureException } from '@/lib/error-reporter';
import { useLazyMount } from '@/lib/use-lazy-mount';
import { cn } from '@/lib/utils';

// Lazy-loaded — log viewer is dev-only-ish, not in the first-paint
// path. Splitting it shaves the console-buffer + dialog plumbing
// from the main bundle until the user opens it.
const LogsDialog = lazy(() =>
  import('./logs-dialog').then((m) => ({ default: m.LogsDialog })),
);

export interface ChatWorkspaceProps {
  handle: PrivchatHandle;
  /** Called when the user clicks the logout button. App.tsx is
   *  responsible for clearing persisted session + disposing the SDK
   *  + returning to the login screen. */
  onLogout: () => void;
  /** R7.3 — switcher state forwarded into the top bar. Optional
   *  so TestApp can mount ChatWorkspace without owning real
   *  multi-account state. When undefined, the switcher renders
   *  but its handlers are no-ops driven by the registry-on-disk
   *  view (legacy-default account only, in test mode). */
  activeAccountKey?: AccountKey | null;
  onSelectAccount?: (key: AccountKey) => void;
  onAddAccount?: () => void;
  /** R7.4 — true while a switch sequencer is in flight; the
   *  switcher trigger + entries + Add-account item disable
   *  themselves so the user can't queue concurrent switches. */
  switching?: boolean;
  /** R7.4 — last switch attempt's failure surface. Rendered inline
   *  in the switcher dropdown so the user sees why the active
   *  account didn't change. `null` after a committed switch. */
  switchError?: SwitchError | null;
  /** Called when the user explicitly dismisses the error chip
   *  (clicking the close icon). App.tsx clears its switch-error state. */
  clearSwitchError?: () => void;
}

interface ActiveChannel {
  channelId: string;
  channelType: number;
  /** Re-mount key so reopening the same channel resets composer/scroll/error. */
  key: number;
  /** 搜索命中跳转锚（server_message_id 字符串）；panel 打开后回灌上下文并定位高亮。 */
  jumpToMessageId?: string;
  /** 从联系人打开的新 DM:record 未同步时的 peer 兜底(标题/presence/资金入口)。 */
  peerUid?: string;
  peerName?: string;
}

export function ChatWorkspace({
  handle: _handle,
  onLogout,
  activeAccountKey,
  onSelectAccount,
  onAddAccount,
  switching,
  switchError,
  clearSwitchError,
}: ChatWorkspaceProps) {
  // Read session uid via the adapter seam rather than `handle.client`
  // directly so test harnesses can mount this workspace with a mock
  // adapter and no real `PrivchatClient` instance.
  const sessionUid = usePrivchatClient().sessionSnapshot().user_id;

  const [tab, setTab] = useState<SidebarTab>('chats');
  const [active, setActive] = useState<ActiveChannel | null>(null);
  // Debounces double-taps on a contact row while channelDirectGetOrCreate
  // is in flight. While set, ContactList disables every row.
  const [openingDirectUid, setOpeningDirectUid] = useState<string | null>(null);

  // Tab badge: title becomes "(N) {original}" when there's any unread.
  // We sum unread_count across the user's channel list — same number the
  // sidebar would render if we showed a global counter.
  const channelList = useChannelList({ skipAutoBootstrap: true });
  const unreadTotal = useMemo(
    () =>
      channelList.conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    [channelList.conversations],
  );
  useTabBadge(unreadTotal);

  // Incoming notifier: ping + (optional) desktop notification on
  // received messages. Suppressed for the currently-active channel
  // when the tab is visible.
  const notifier = useIncomingNotifier(active?.channelId ?? null);

  // Logs window — purely a debug affordance, but useful when running
  // mobile-Safari-style without devtools. Patches `console.*` once at
  // import time (see log-buffer.ts side effect).
  const [logsOpen, setLogsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const openDirect = useOpenDirectConversation();

  const onSelect = useCallback((channelId: string, channelType: number, peer?: { uid: string; name?: string }) => {
    setActive((prev) => ({
      channelId,
      channelType,
      key: (prev?.key ?? 0) + 1,
      peerUid: peer?.uid,
      peerName: peer?.name,
    }));
  }, []);

  // 搜索命中：打开会话并带跳转锚（MESSAGE_HISTORY spec §5 jump-to-message）。
  const onPickSearchHit = useCallback(
    (channelId: string, channelType: number, messageId: string) => {
      setSearchOpen(false);
      setActive((prev) => ({
        channelId,
        channelType,
        key: (prev?.key ?? 0) + 1,
        jumpToMessageId: messageId,
      }));
    },
    [],
  );

  const onOpenContact = useCallback(
    async (user_id: string, displayName?: string) => {
      if (openingDirectUid !== null) return;
      setOpeningDirectUid(user_id);
      try {
        const { channelId, channelType } = await openDirect(user_id);
        // 新建 DM 时 channel record 尚未同步(title=对方uid 拿不到,标题会回退成
        // channel_id)—— 显式带上 peer 信息,面板即时可用(H5 peer_uid 同款修复)。
        onSelect(channelId, channelType, { uid: user_id, name: displayName });
        setTab('chats');
      } catch (err) {
        captureException(err, { source: 'chat-workspace.openDirect' });
      } finally {
        setOpeningDirectUid(null);
      }
    },
    [openDirect, onSelect, openingDirectUid],
  );

  const onOpenGroup = useCallback(
    (channelId: string, channelType: number) => {
      onSelect(channelId, channelType);
      setTab('chats');
    },
    [onSelect],
  );

  const onBackToList = () => setActive(null);

  const activeId = active === null ? null : `${active.channelId}:${active.channelType}`;

  return (
    <div className="flex h-dvh flex-col bg-muted">
      <TopBar
        uid={sessionUid}
        onLogout={onLogout}
        notifier={notifier}
        onOpenLogs={() => setLogsOpen(true)}
        activeAccountKey={activeAccountKey ?? null}
        onSelectAccount={onSelectAccount}
        onAddAccount={onAddAccount}
        switching={switching ?? false}
        switchError={switchError ?? null}
        clearSwitchError={clearSwitchError}
        onOpenDirectByUserId={onOpenContact}
        onOpenGroupChannel={onOpenGroup}
      />
      <LazyLogsDialog open={logsOpen} onOpenChange={setLogsOpen} />

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* List pane */}
        <MessageSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onPick={onPickSearchHit}
        />
        <aside
          className={cn(
            'flex flex-col min-h-0 border-r bg-card',
            'md:w-[320px] md:shrink-0',
            // <md: list is the only screen until a panel is opened
            active === null ? 'flex-1 md:flex-none' : 'hidden md:flex',
          )}
        >
          <SidebarTabs active={tab} onChange={setTab} />

          <div
            data-testid="pane-chats"
            className={cn('flex-1 min-h-0', tab === 'chats' ? 'flex flex-col' : 'hidden')}
          >
            <ConversationList activeId={activeId} onSelect={onSelect} onOpenSearch={() => setSearchOpen(true)} />
          </div>
          <div
            data-testid="pane-contacts"
            className={cn('flex-1 min-h-0', tab === 'contacts' ? 'flex flex-col' : 'hidden')}
          >
            <ContactList onOpen={onOpenContact} openingUid={openingDirectUid} />
          </div>
          <div
            data-testid="pane-groups"
            className={cn('flex-1 min-h-0', tab === 'groups' ? 'flex flex-col' : 'hidden')}
          >
            <GroupList onOpen={onOpenGroup} />
          </div>
        </aside>

        {/* Panel pane */}
        <main
          className={cn(
            'flex flex-1 min-h-0 flex-col bg-card',
            // <md: panel only renders when something is selected
            active === null ? 'hidden md:flex' : 'flex',
          )}
        >
          {active !== null ? (
            <ConversationPanel
              key={active.key}
              channelId={active.channelId}
              channelType={active.channelType}
              title={active.peerName}
              peerUidHint={active.peerUid}
              jumpToMessageId={active.jumpToMessageId}
              onBack={onBackToList}
            />
          ) : (
            <EmptyPlaceholder />
          )}
        </main>
      </div>
    </div>
  );
}

/** Lazy wrapper for the logs dialog. Mounts on first open, stays
 *  mounted afterwards so the Radix close-state animation can play
 *  out when the user dismisses. */
function LazyLogsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mounted = useLazyMount(open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <LogsDialog open={open} onOpenChange={onOpenChange} />
    </Suspense>
  );
}

function TopBar({
  uid,
  onLogout,
  notifier,
  onOpenLogs,
  activeAccountKey,
  onSelectAccount,
  onAddAccount,
  switching,
  switchError,
  clearSwitchError,
  onOpenDirectByUserId,
  onOpenGroupChannel,
}: {
  uid: string | undefined;
  onLogout: () => void;
  notifier: IncomingNotifier;
  onOpenLogs: () => void;
  activeAccountKey: AccountKey | null;
  onSelectAccount?: (key: AccountKey) => void;
  onAddAccount?: () => void;
  switching: boolean;
  switchError: SwitchError | null;
  clearSwitchError?: () => void;
  /** Scan flow: user-card "open chat / send message" handler.
   *  ChatWorkspace wires this to `useOpenDirectConversation` so the
   *  scanned user's direct channel pops in the right pane. If they're
   *  not yet friends, the conversation header still renders — host's
   *  add-friend affordance is reachable from there. */
  onOpenDirectByUserId: (userId: string) => void;
  /** Scan flow: after joining a group (status='joined') jump the user
   *  into the group's channel. channel_id == group_id by server
   *  invariant; channel_type is 2 for groups. */
  onOpenGroupChannel: (channelId: string, channelType: number) => void;
}) {
  const { t } = useTranslation();
  // Self profile drives the top-bar identity display. It may be empty
  // until the entity sync hydrates the cache; in that gap we fall back
  // to the platform name.
  const me = useUserProfile(uid ?? '');
  const display = me?.nickname ?? me?.username ?? t('app.name');
  const seed = uid !== undefined && uid !== '' ? `u:${uid}` : 'self';
  const [myQrOpen, setMyQrOpen] = useState(false);
  const moneyUi = useMoneyUi();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [scanQrOpen, setScanQrOpen] = useState(false);

  return (
    <>
    <header className="flex shrink-0 items-center justify-between border-b bg-card px-3 py-2">
      <ProfileCard user={me} fallbackTitle={display}>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
        >
          {/* P4.2 local-first:自己的头像也按 uid 走 useAvatarModel。 */}
          <Avatar
            seed={seed}
            label={display}
            size="sm"
            userId={uid}
            remoteUrl={me?.avatar_url}
          />
          <span className="text-sm font-semibold">
            {display}
            <span className="text-muted-foreground font-normal">@{brandConfig.appName}</span>
          </span>
          <ConnectionPill />
        </button>
      </ProfileCard>

      <div className="flex items-center gap-1">
        <NotifyToggles notifier={notifier} />
        {onSelectAccount !== undefined && onAddAccount !== undefined && (
          <AccountSwitcher
            activeAccountKey={activeAccountKey ?? null}
            onSelectAccount={onSelectAccount}
            onAddAccount={onAddAccount}
            disabled={switching}
            errorI18nKey={switchError?.i18nKey ?? null}
            onDismissError={clearSwitchError}
          />
        )}
        {getConfiguredAccountMode() === 'platform' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInviteOpen(true)}
            aria-label={t('invite.entry')}
            title={t('invite.entry')}
            data-testid="topbar-invite"
          >
            <Ticket className="h-4 w-4" />
          </Button>
        )}
        {getConfiguredAccountMode() === 'platform' && (
          <InviteBindDialog open={inviteOpen} onOpenChange={setInviteOpen} />
        )}
        {getConfiguredAccountMode() === 'platform' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => moneyUi.open({ type: 'wallet' })}
            aria-label={t('money.wallet.title')}
            title={t('money.wallet.title')}
            data-testid="topbar-wallet"
          >
            <Wallet className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMyQrOpen(true)}
          aria-label={t('qrcode.my_qr')}
          title={t('qrcode.my_qr')}
          data-testid="topbar-my-qr"
        >
          <QrCode className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setScanQrOpen(true)}
          aria-label={t('qrcode.scan_entry')}
          title={t('qrcode.scan_entry')}
          data-testid="topbar-scan-qr"
        >
          <ScanLine className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenLogs}
          aria-label={t('logs.open')}
          title={t('logs.open')}
        >
          <FileText className="h-4 w-4" />
        </Button>
        <LangSwitcher />
        <ThemeToggle />
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          aria-label={t('workspace.logout')}
          title={t('workspace.logout')}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
    <QrcodeDisplayDialog
      open={myQrOpen}
      onOpenChange={setMyQrOpen}
      mode={{ kind: 'user' }}
    />
    <QrcodeScanDialog
      open={scanQrOpen}
      onOpenChange={setScanQrOpen}
      onOpenUserProfile={(uid) => {
        // User scanned someone's namecard QR → open a direct chat
        // with them. Conversation header's add-friend affordance
        // covers the non-friend case (matches the standard route
        // through ContactFindDialog).
        onOpenDirectByUserId(uid);
      }}
      onJoinedGroup={(gid) => {
        // status='joined' branch: bring the user straight into the
        // newly-joined group's channel.
        onOpenGroupChannel(gid, 2);
      }}
    />
    </>
  );
}

function NotifyToggles({ notifier }: { notifier: IncomingNotifier }) {
  const { t } = useTranslation();
  const onDesktopClick = () => {
    if (notifier.desktopState === 'unsupported') return;
    if (notifier.desktopState === 'denied') {
      alert(t('notify.desktop_blocked'));
      return;
    }
    if (notifier.desktopState === 'default') {
      void notifier.requestDesktop();
      return;
    }
    // granted — toggle the user pref
    notifier.setDesktopEnabled(!notifier.desktopEnabled);
  };
  const desktopActive =
    notifier.desktopState === 'granted' && notifier.desktopEnabled;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => notifier.setSoundEnabled(!notifier.soundEnabled)}
        aria-label={t('notify.sound_label')}
        title={t('notify.sound_label')}
      >
        {notifier.soundEnabled ? (
          <Volume2 className="h-4 w-4" />
        ) : (
          <VolumeX className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
      {notifier.desktopState !== 'unsupported' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDesktopClick}
          aria-label={t('notify.desktop_label')}
          title={
            notifier.desktopState === 'default'
              ? t('notify.desktop_request')
              : t('notify.desktop_label')
          }
        >
          {desktopActive ? (
            <Bell className="h-4 w-4" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      )}
    </>
  );
}

function ConnectionPill() {
  const { t } = useTranslation();
  // P4.2 统一运行时语义:pill 状态由 SDK 唯一决策函数给出(固定优先级,
  // 与 App/H5 同源):auth_expired > offline > [server_busy > syncing >
  // connected] > reconnecting > connecting。工作区在登录后挂载,所以
  // hasStartedConnectionFlow=true;web 的绿点常显,故 showConnectedBanner
  // =true(connected 稳态不会退成 hidden)。
  const kind = useRuntimeBanner(true, true);
  if (kind === 'hidden') return null;
  // Dot color: green = good, amber = transitional/degraded, red =
  // nothing's getting through (or the session needs a re-login).
  const dot =
    kind === 'connected'
      ? 'bg-emerald-500'
      : kind === 'offline' || kind === 'auth_expired'
        ? 'bg-rose-500'
        : 'bg-amber-500';
  // 'offline' reuses the existing "已断开" copy; the other kinds have
  // dedicated keys (added to every locale — LocaleSchema enforces parity).
  const textKey = kind === 'offline' ? 'disconnected' : kind;
  return (
    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {t(`connection.${textKey}`)}
    </span>
  );
}

function EmptyPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center bg-card text-sm text-muted-foreground">
      {t('workspace.select_conversation')}
    </div>
  );
}
