import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useChannelList,
  useOpenDirectConversation,
  usePrivchatClient,
} from '@privchat/react';
import type { PrivchatHandle } from '@/lib/privchat-client';
import type { AccountKey } from '@/lib/account-key';
import type { SwitchError } from '@/App';
import { ConversationList } from '@/features/chat/conversation-list';
import { MessageSearchDialog } from '@/features/chat/message-search-dialog';
import { ConversationPanel } from '@/features/chat/conversation-panel';
import { ContactList } from '@/features/chat/contact-list';
import { GroupList } from '@/features/chat/group-list';
import { getConfiguredAccountMode } from '@/lib/account-mode';
import { useTabBadge } from '@/features/chat/use-tab-badge';
import { useIncomingNotifier } from '@/features/chat/use-incoming-notifier';
import { captureException } from '@/lib/error-reporter';
import { useLazyMount } from '@/lib/use-lazy-mount';
import { cn } from '@/lib/utils';
import { isWorkspaceHash } from '@/features/workspace/routes';
import { AppRail, type AppSection } from '@/app/app-rail';
import { AccountMenu } from '@/app/account-menu';

const WorkspaceScreen = lazy(() => import('@/features/workspace/workspace-screen'));

// Keep the log viewer out of the first-paint bundle.
const LogsDialog = lazy(() =>
  import('@/features/chat/logs-dialog').then((m) => ({ default: m.LogsDialog })),
);

export interface AuthenticatedShellProps {
  handle: PrivchatHandle;
  /** Called when the user clicks the logout button. App.tsx is
   *  responsible for clearing persisted session + disposing the SDK
   *  + returning to the login screen. */
  onLogout: () => void;
  /** R7.3 — switcher state forwarded into the account menu. Optional
   *  so TestApp can mount AuthenticatedShell without owning real
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

export function AuthenticatedShell({
  handle,
  onLogout,
  activeAccountKey,
  onSelectAccount,
  onAddAccount,
  switching,
  switchError,
  clearSwitchError,
}: AuthenticatedShellProps) {
  const [workRoute, setWorkRoute] = useState(location.hash);
  useEffect(() => {
    const change = () => {
      setWorkRoute(location.hash);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  // Read session uid via the adapter seam rather than `handle.client`
  // directly so test harnesses can mount this workspace with a mock
  // adapter and no real `PrivchatClient` instance.
  const sessionUid = usePrivchatClient().sessionSnapshot().user_id;

  const platform = getConfiguredAccountMode() === 'platform';
  const section: AppSection = platform && isWorkspaceHash(workRoute) ? 'workspace'
    : workRoute === '#/contacts' ? 'contacts' : workRoute === '#/groups' ? 'groups' : 'chats';
  const [active, setActive] = useState<ActiveChannel | null>(null);
  // Debounces double-taps on a contact row while channelDirectGetOrCreate
  // is in flight. While set, ContactList disables every row.
  const [openingDirectUid, setOpeningDirectUid] = useState<string | null>(null);

  // Tab badge: title becomes "(N) {original}" when there's any unread.
  // We sum unread_count across the user's channel list — same number the
  // sidebar would render if we showed a global counter.
  const channelList = useChannelList({ skipAutoBootstrap: true });
  // P6-2 §24：总未读口径统一 = 非静音会话未读之和（对齐 App BadgeState / H5），静音会话不计入标题角标。
  const unreadTotal = useMemo(
    () =>
      channelList.conversations.reduce(
        (sum, c) => sum + (c.muted ? 0 : c.unread_count || 0),
        0,
      ),
    [channelList.conversations],
  );
  useTabBadge(unreadTotal);

  // Incoming notifier: ping + (optional) desktop notification on
  // received messages. Suppressed for the currently-active channel
  // when the tab is visible.
  const notifier = useIncomingNotifier(section === 'chats' ? active?.channelId ?? null : null);

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
        location.hash = '';
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
      location.hash = '';
    },
    [onSelect],
  );

  const onBackToList = () => setActive(null);

  const activeId = active === null ? null : `${active.channelId}:${active.channelType}`;

  const onNavigate = (next: AppSection) => {
    if (next === section) return;
    location.hash = next === 'chats' ? '' : `/${next}`;
  };

  return (
    <div className="flex h-dvh min-w-0 flex-col-reverse bg-muted md:flex-row">
      <AppRail section={section} platform={platform} unread={unreadTotal} onNavigate={onNavigate}>
        <AccountMenu
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
      </AppRail>
      <LazyLogsDialog open={logsOpen} onOpenChange={setLogsOpen} />

      {section === 'workspace' && (
        <main data-testid="workspace-main" className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Suspense fallback={<WorkspaceLoading />}>
            <WorkspaceScreen client={handle.client} accountKey={activeAccountKey ?? null} />
          </Suspense>
        </main>
      )}

      <div className={cn('min-h-0 min-w-0 flex-1', section === 'workspace' ? 'hidden' : 'flex flex-col md:flex-row')}>
        {/* List pane */}
        <MessageSearchDialog
          open={searchOpen && section === 'chats'}
          onOpenChange={setSearchOpen}
          onPick={onPickSearchHit}
        />
        <aside
          className={cn(
            'flex flex-col min-h-0 border-r bg-card',
            'md:w-[320px] md:shrink-0',
            // <md: list is the only screen until a panel is opened
            section !== 'chats' || active === null ? 'flex-1 md:flex-none' : 'hidden md:flex',
          )}
        >
          <div
            data-testid="pane-chats"
            className={cn('flex-1 min-h-0', section === 'chats' ? 'flex flex-col' : 'hidden')}
          >
            <ConversationList activeId={activeId} onSelect={onSelect} onOpenSearch={() => setSearchOpen(true)} />
          </div>
          <div
            data-testid="pane-contacts"
            className={cn('flex-1 min-h-0', section === 'contacts' ? 'flex flex-col' : 'hidden')}
          >
            <ContactList onOpen={onOpenContact} openingUid={openingDirectUid} />
          </div>
          <div
            data-testid="pane-groups"
            className={cn('flex-1 min-h-0', section === 'groups' ? 'flex flex-col' : 'hidden')}
          >
            <GroupList onOpen={onOpenGroup} />
          </div>
        </aside>

        {/* Panel pane */}
        <main
          className={cn(
            'flex-1 min-h-0 min-w-0 flex-col bg-card',
            // <md: panel only renders when something is selected
            section !== 'chats' || active === null ? 'hidden md:flex' : 'flex',
          )}
        >
          <div className={cn('min-h-0 flex-1 flex-col', section === 'chats' ? 'flex' : 'hidden')}>
            {active !== null ? (
              <ConversationPanel
                key={active.key}
                visible={section === 'chats'}
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
          </div>
          {section !== 'chats' && section !== 'workspace' && <EmptyPlaceholder />}
        </main>
      </div>
    </div>
  );
}

function WorkspaceLoading() {
  const { t } = useTranslation();
  return <div role="status" className="grid h-full place-items-center text-sm text-muted-foreground">{t('app.loading')}</div>;
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

function EmptyPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center bg-card text-sm text-muted-foreground">
      {t('workspace.select_conversation')}
    </div>
  );
}
