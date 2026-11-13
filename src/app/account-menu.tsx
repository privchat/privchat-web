import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff, CalendarCheck, Copy, FileText, LogOut, QrCode, ScanLine, Settings, Ticket, UserRound, Volume2, VolumeX, Wallet } from 'lucide-react';
import { useRuntimeBanner, useUserProfile } from '@privchat/react';
import { Avatar } from '@/features/chat/avatar';
import { AccountSwitcher } from '@/features/auth/account-switcher';
import { QrcodeDisplayDialog } from '@/features/chat/qrcode-display-dialog';
import { QrcodeScanDialog } from '@/features/chat/qrcode-scan-dialog';
import type { IncomingNotifier } from '@/features/chat/use-incoming-notifier';
import { useMoneyUi } from '@/features/money/money-ui';
import { InviteBindDialog } from '@/features/profile/invite-bind-dialog';
import { ProfileEditDialog } from '@/features/profile/profile-edit-dialog';
import { PrivacySettingsDialog } from '@/features/profile/privacy-settings-dialog';
import { BlacklistDialog } from '@/features/profile/blacklist-dialog';
import { SignInDialog } from '@/features/profile/sign-in-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { LangSwitcher } from '@/components/lang-switcher';
import { useAccountCapabilities } from '@/lib/account-capabilities';
import { getConfiguredAccountMode } from '@/lib/account-mode';
import type { AccountKey } from '@/lib/account-key';
import type { SwitchError } from '@/App';
import { cn } from '@/lib/utils';

type AccountView = 'qr' | 'scan' | 'invite' | 'profile' | 'settings' | 'privacy' | 'blacklist' | 'sign-in';

export function AccountMenu({
  uid, onLogout, notifier, onOpenLogs, activeAccountKey, onSelectAccount, onAddAccount, switching,
  switchError, clearSwitchError, onOpenDirectByUserId, onOpenGroupChannel,
}: {
  uid?: string;
  onLogout: () => void;
  notifier: IncomingNotifier;
  onOpenLogs: () => void;
  activeAccountKey: AccountKey | null;
  onSelectAccount?: (key: AccountKey) => void;
  onAddAccount?: () => void;
  switching: boolean;
  switchError: SwitchError | null;
  clearSwitchError?: () => void;
  onOpenDirectByUserId: (userId: string) => void;
  onOpenGroupChannel: (channelId: string, channelType: number) => void;
}) {
  const { t } = useTranslation();
  const me = useUserProfile(uid ?? '');
  const display = me?.nickname || me?.username || t('app.name');
  const seed = uid ? `u:${uid}` : 'self';
  const capabilities = useAccountCapabilities();
  const platform = getConfiguredAccountMode() === 'platform';
  const moneyUi = useMoneyUi();
  const [view, setView] = useState<AccountView | null>(null);
  const close = (open: boolean) => { if (!open) setView(null); };
  const avatar = <Avatar seed={seed} label={display} size="sm" userId={uid} remoteUrl={me?.avatar_url} className="rounded-full" />;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="self-profile-trigger"
            data-switching={switching ? '1' : '0'}
            disabled={switching}
            aria-label={t('accountMenu.label')}
            title={display}
            className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {avatar}
            <ConnectionPill compact />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={9} collisionPadding={8} className="w-64 max-w-[calc(100vw-1rem)] rounded-xl p-1.5">
          <DropdownMenuLabel className="flex items-center gap-2 px-2 py-2.5">
            {avatar}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{display}</span>
              <ConnectionPill />
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="account-my-qr" onSelect={() => setView('qr')}><QrCode className="h-4 w-4" />{t('qrcode.my_qr')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setView('scan')}><ScanLine className="h-4 w-4" />{t('qrcode.scan_entry')}</DropdownMenuItem>
          {platform && (
            <>
              <DropdownMenuItem data-testid="account-wallet" onSelect={() => moneyUi.open({ type: 'wallet' })}><Wallet className="h-4 w-4" />{t('money.wallet.title')}</DropdownMenuItem>
              <DropdownMenuItem data-testid="account-invite" onSelect={() => setView('invite')}><Ticket className="h-4 w-4" />{t('invite.entry')}</DropdownMenuItem>
            </>
          )}
          {capabilities.memberSignIn && <DropdownMenuItem onSelect={() => setView('sign-in')}><CalendarCheck className="h-4 w-4" />{t('sign_in.open_button')}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {onSelectAccount && onAddAccount && (
            <AccountSwitcher activeAccountKey={activeAccountKey} onSelectAccount={onSelectAccount} onAddAccount={onAddAccount} disabled={switching}
              errorI18nKey={switchError?.i18nKey ?? null} onDismissError={clearSwitchError} />
          )}
          <DropdownMenuItem onSelect={() => setView('profile')}><UserRound className="h-4 w-4" />{t('accountMenu.profile')}</DropdownMenuItem>
          <DropdownMenuItem data-testid="account-settings" onSelect={() => setView('settings')}><Settings className="h-4 w-4" />{t('accountMenu.settings')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onLogout}><LogOut className="h-4 w-4" />{t('workspace.logout')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <QrcodeDisplayDialog open={view === 'qr'} onOpenChange={close} mode={{ kind: 'user' }} />
      <QrcodeScanDialog open={view === 'scan'} onOpenChange={close} onOpenUserProfile={onOpenDirectByUserId} onJoinedGroup={gid => onOpenGroupChannel(gid, 2)} />
      {platform && <InviteBindDialog open={view === 'invite'} onOpenChange={close} />}
      {capabilities.profileEdit ? <ProfileEditDialog open={view === 'profile'} onOpenChange={close} /> : (
        <Dialog open={view === 'profile'} onOpenChange={close}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t('accountMenu.profile')}</DialogTitle></DialogHeader>
            <div className="flex items-center gap-3">{avatar}<span className="min-w-0 break-words">{display}</span></div>
            {me?.username && <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-muted-foreground">@{me.username}</span>
              <Button variant="ghost" size="sm" aria-label={t('copy.label')} onClick={() => void navigator.clipboard.writeText(me.username).catch(() => {})}><Copy className="h-4 w-4" /></Button>
            </div>}
          </DialogContent>
        </Dialog>
      )}
      {capabilities.memberSignIn && <SignInDialog open={view === 'sign-in'} onOpenChange={close} />}
      <PrivacySettingsDialog open={view === 'privacy'} onOpenChange={close} />
      <BlacklistDialog open={view === 'blacklist'} onOpenChange={close} />
      <Dialog open={view === 'settings'} onOpenChange={close}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('accountMenu.settings')}</DialogTitle></DialogHeader>
          <div className="flex flex-wrap gap-1">
            <NotifyToggles notifier={notifier} />
            <LangSwitcher />
            <ThemeToggle />
          </div>
          <div className="grid gap-1">
            <Button variant="ghost" className="justify-start" onClick={() => setView('privacy')}>{t('privacy.open_button')}</Button>
            <Button variant="ghost" className="justify-start" data-testid="profile-card-blacklist-self" onClick={() => setView('blacklist')}>{t('blacklist.open_button')}</Button>
            <Button variant="ghost" className="justify-start gap-2" onClick={() => { setView(null); onOpenLogs(); }}><FileText className="h-4 w-4" />{t('logs.open')}</Button>
          </div>
        </DialogContent>
      </Dialog>
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

function ConnectionPill({ compact = false }: { compact?: boolean }) {
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
  if (compact) return <span aria-label={t(`connection.${textKey}`)} className={cn('absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border-2 border-sidebar', dot)} />;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {t(`connection.${textKey}`)}
    </span>
  );
}
