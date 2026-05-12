import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';
import { LangSwitcher } from '@/components/lang-switcher';
import { getAuthProvider } from '@/lib/account-auth-provider';
import { useAccountCapabilities } from '@/lib/account-capabilities';
import { getPlatformBaseUrl } from '@/lib/account-mode';
import { getLoginErrorMessage } from '@/lib/login-error-message';
import type { RequiredAction } from '@/lib/required-action';
import type { PersistedSession } from '@/lib/session-storage';
import { QrLoginPanel } from './qr-login-panel';
import { cn } from '@/lib/utils';

export interface LoginPageProps {
  /** Called when the credential RPC succeeds. R7.3 contract: this
   *  page does not authenticate a long-lived client — it acquires
   *  credentials and hands them off; App.tsx persists + connects.
   *  R8.4c — second arg is `LoginResult.requiredActions` (always
   *  an array; BUILTIN passes `[]`, PLATFORM passes the server's
   *  post-login required actions list). */
  onLoggedIn: (
    credentials: Omit<PersistedSession, 'saved_at'>,
    requiredActions: RequiredAction[],
  ) => void;
  /** Initial gateway URL — defaults to localhost dev. */
  initialUrl?: string;
  /** When set, the page renders a "Cancel" affordance that
   *  unwinds back to the previous active account. Used in the
   *  R7.3 add-account flow; left undefined for first-time login
   *  (no fallback to return to). */
  onCancel?: () => void;
}

/** R8.3b: PLATFORM E.164 client-side check. Lightweight; final
 *  validation happens server-side. `+` followed by 8–15 digits,
 *  first digit non-zero (per ITU E.164). */
const E164_RE = /^\+[1-9]\d{7,14}$/;

export function LoginPage({ onLoggedIn, initialUrl, onCancel }: LoginPageProps) {
  const { t } = useTranslation();
  const capabilities = useAccountCapabilities();
  // R8.3b: capability-driven branch. PLATFORM lights up smsLogin
  // and turns off the BUILTIN-style password form. UI never reads
  // `mode === 'platform'` — it asks the matrix what's available.
  const isSmsMode = capabilities.smsLogin === true;
  // R8.5c: QR tab visible only when the PLATFORM capability matrix
  // explicitly grants `qrLogin`. BUILTIN never sees it.
  const hasQrTab = capabilities.qrLogin === true;

  const [url, setUrl] = useState(initialUrl ?? 'ws://127.0.0.1:9080/');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // R8.5c: which PLATFORM-mode auth method is active. Persisted in
  // component state (not URL) — fresh on each login attempt.
  const [activeTab, setActiveTab] = useState<'sms' | 'qr'>('sms');
  // R8.5c: monotonic counter the QR panel reads as `sessionEpoch`
  // so re-selecting the QR tab restarts the session (the panel
  // stays mounted to preserve the in-flight cleanup hook).
  const [qrEpoch, setQrEpoch] = useState(0);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-muted p-6">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <LangSwitcher />
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('login.title')}</CardTitle>
          <CardDescription>{t('login.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {import.meta.env.DEV && (
            <FormRow id="gateway" label={t('login.gateway_url')}>
              <Input
                id="gateway"
                value={url}
                onChange={(e) => setUrl(e.currentTarget.value)}
                placeholder="ws://host:port/"
                disabled={busy}
              />
            </FormRow>
          )}

          {isSmsMode && hasQrTab ? (
            <AuthMethodTabs
              active={activeTab}
              onChange={(next) => {
                setActiveTab(next);
                setError(null);
                if (next === 'qr') setQrEpoch((n) => n + 1);
              }}
            />
          ) : null}

          {isSmsMode ? (
            activeTab === 'qr' && hasQrTab ? (
              <QrLoginPanel
                serverUrl={url}
                onLoggedIn={onLoggedIn}
                sessionEpoch={qrEpoch}
              />
            ) : (
              <PlatformSmsForm
                serverUrl={url}
                busy={busy}
                setBusy={setBusy}
                setError={setError}
                onLoggedIn={onLoggedIn}
              />
            )
          ) : (
            <BuiltinPasswordForm
              serverUrl={url}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onLoggedIn={onLoggedIn}
              showRegister={capabilities.passwordLogin}
            />
          )}

          {onCancel !== undefined && (
            // R7.3: only rendered in the add-account flow. No cancel
            // affordance during first-time login because there's
            // nothing to fall back to.
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={onCancel}
              disabled={busy}
            >
              {t('accounts.cancel_add')}
            </Button>
          )}

          {error !== null && (
            <p className="text-sm text-destructive" data-testid="login-error">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────── BUILTIN: username + password form ──────────────────

interface FormBranchProps {
  serverUrl: string;
  busy: boolean;
  setBusy: (next: boolean) => void;
  setError: (next: string | null) => void;
  onLoggedIn: (
    credentials: Omit<PersistedSession, 'saved_at'>,
    requiredActions: RequiredAction[],
  ) => void;
}

function BuiltinPasswordForm({
  serverUrl,
  busy,
  setBusy,
  setError,
  onLoggedIn,
  showRegister,
}: FormBranchProps & { showRegister: boolean }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit =
    !busy &&
    serverUrl.trim() !== '' &&
    username.trim() !== '' &&
    password.length > 0;

  const submit = async (mode: 'login' | 'register') => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const provider = await getAuthProvider();
      const input = {
        serverUrl,
        username,
        password,
        device: makeDevice(),
      };
      let result;
      if (mode === 'register') {
        if (provider.registerWithPassword === undefined) {
          throw new Error('register is not supported in this account mode');
        }
        result = await provider.registerWithPassword(input);
      } else {
        if (provider.loginWithPassword === undefined) {
          throw new Error('password login is not supported in this account mode');
        }
        result = await provider.loginWithPassword(input);
      }
      onLoggedIn(
        {
          url: result.serverUrl,
          user_id: result.userId,
          access_token: result.accessToken,
          device_id: result.deviceId,
        },
        // R8.4c — BUILTIN always returns []; pass through for parity.
        result.requiredActions,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        mode === 'login'
          ? t('login.error_login', { message: msg })
          : t('login.error_register', { message: msg }),
      );
      setBusy(false);
    }
    // No setBusy(false) on success — onLoggedIn unmounts this page.
  };

  return (
    <>
      <FormRow id="username" label={t('login.username')}>
        <Input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          autoComplete="username"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void submit('login');
          }}
        />
      </FormRow>
      <FormRow id="password" label={t('login.password')}>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          autoComplete="current-password"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void submit('login');
          }}
        />
      </FormRow>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="default"
          onClick={() => void submit('login')}
          disabled={!canSubmit}
        >
          {busy ? t('login.signing_in') : t('login.login')}
        </Button>
        {showRegister && (
          <Button
            variant="outline"
            onClick={() => void submit('register')}
            disabled={!canSubmit}
          >
            {busy ? '…' : t('login.register')}
          </Button>
        )}
      </div>
    </>
  );
}

// ─────────── PLATFORM: mobile + SMS code form ────────────────────

function PlatformSmsForm({
  serverUrl,
  busy,
  setBusy,
  setError,
  onLoggedIn,
}: FormBranchProps) {
  const { t } = useTranslation();
  const [mobile, setMobile] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const canSendCode =
    !busy && cooldown === 0 && mobile.trim() !== '';
  const canSubmit =
    !busy &&
    serverUrl.trim() !== '' &&
    E164_RE.test(mobile.trim()) &&
    smsCode.trim() !== '';

  // R8.3b: cooldown countdown. setInterval cleaned up on unmount
  // and on cooldown reaching 0 — both paths matter so a Cancel
  // doesn't leave a dangling timer that calls setState after the
  // component is gone.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (cooldown <= 0) {
      if (tickRef.current !== null) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    if (tickRef.current === null) {
      tickRef.current = setInterval(() => {
        setCooldown((prev) => (prev <= 0 ? 0 : prev - 1));
      }, 1000);
    }
    return () => {
      if (tickRef.current !== null) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [cooldown]);

  const sendCode = async () => {
    const m = mobile.trim();
    if (!E164_RE.test(m)) {
      setError(t('login.error_invalid_mobile'));
      return;
    }
    const baseUrl = getPlatformBaseUrl();
    if (baseUrl === null) {
      setError(t('login.error_config'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const provider = await getAuthProvider();
      if (provider.sendSmsCode === undefined) {
        throw new Error('sendSmsCode is not supported in this account mode');
      }
      const result = await provider.sendSmsCode({
        platformBaseUrl: baseUrl,
        mobile: m,
        scene: 'login',
      });
      setCooldown(
        Number.isFinite(result.cooldownSeconds) && result.cooldownSeconds > 0
          ? Math.floor(result.cooldownSeconds)
          : 60,
      );
    } catch (e) {
      setError(getLoginErrorMessage(e, 'send-sms', t));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    const m = mobile.trim();
    if (!E164_RE.test(m)) {
      setError(t('login.error_invalid_mobile'));
      return;
    }
    const baseUrl = getPlatformBaseUrl();
    if (baseUrl === null) {
      setError(t('login.error_config'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const provider = await getAuthProvider();
      if (provider.loginWithSms === undefined) {
        throw new Error('loginWithSms is not supported in this account mode');
      }
      const result = await provider.loginWithSms({
        platformBaseUrl: baseUrl,
        serverUrl,
        mobile: m,
        smsCode: smsCode.trim(),
        device: makeDevice(),
      });
      // R8.3b — PLATFORM session blob MUST carry account_mode +
      // platform_base_url + refresh_token (R7/R8 compat note).
      // App.tsx persists what we hand it via persistSessionForAccount;
      // missing fields here = missing context for refresh / restore.
      // R8.4c — also pass requiredActions (server's post-login gate
      // signal) so App.tsx can prime the RequiredActionsGate without
      // a list() round-trip on first paint.
      onLoggedIn(
        {
          url: result.serverUrl,
          user_id: result.userId,
          access_token: result.accessToken,
          device_id: result.deviceId,
          account_mode: result.accountMode,
          ...(result.platformBaseUrl !== undefined
            ? { platform_base_url: result.platformBaseUrl }
            : {}),
          ...(result.refreshToken !== undefined
            ? { refresh_token: result.refreshToken }
            : {}),
        },
        result.requiredActions,
      );
    } catch (e) {
      setError(getLoginErrorMessage(e, 'sms-login', t));
      setBusy(false);
    }
    // No setBusy(false) on success — onLoggedIn unmounts this page.
  };

  return (
    <>
      <FormRow id="mobile" label={t('login.mobile_label')}>
        <Input
          id="mobile"
          value={mobile}
          onChange={(e) => setMobile(e.currentTarget.value)}
          autoComplete="tel"
          inputMode="tel"
          placeholder={t('login.mobile_placeholder')}
          disabled={busy}
          data-testid="login-mobile-input"
        />
      </FormRow>
      <FormRow id="sms-code" label={t('login.sms_code_label')}>
        <div className="flex gap-2">
          <Input
            id="sms-code"
            value={smsCode}
            onChange={(e) => setSmsCode(e.currentTarget.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder={t('login.sms_code_placeholder')}
            disabled={busy}
            data-testid="login-sms-code-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) void submit();
            }}
          />
          <Button
            variant="outline"
            onClick={() => void sendCode()}
            disabled={!canSendCode}
            data-testid="login-send-sms-code"
          >
            {busy
              ? t('login.sending_sms_code')
              : cooldown > 0
                ? t('login.resend_sms_code', { seconds: cooldown })
                : t('login.send_sms_code')}
          </Button>
        </div>
      </FormRow>
      <p className="text-xs text-muted-foreground">{t('login.sms_code_hint')}</p>

      <Button
        variant="default"
        className="w-full"
        onClick={() => void submit()}
        disabled={!canSubmit}
        data-testid="login-sms-submit"
      >
        {busy ? t('login.signing_in') : t('login.login')}
      </Button>
    </>
  );
}

// ─────────── PLATFORM: SMS / QR tab toggle ──────────────────────

function AuthMethodTabs({
  active,
  onChange,
}: {
  active: 'sms' | 'qr';
  onChange: (next: 'sms' | 'qr') => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
      role="tablist"
      data-testid="login-tabs"
    >
      <TabButton
        active={active === 'sms'}
        onClick={() => onChange('sms')}
        testId="login-tab-sms"
      >
        {t('login.sms_tab')}
      </TabButton>
      <TabButton
        active={active === 'qr'}
        onClick={() => onChange('qr')}
        testId="login-tab-qr"
      >
        {t('login.qr_tab')}
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

// ─────────── shared bits ─────────────────────────────────────────

function FormRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function makeDevice(): {
  device_id: string;
  device_type: string;
  app_id: string;
  device_name: string;
  app_version: string;
} {
  return {
    device_id: pseudoUuidV4(),
    device_type: 'web',
    app_id: 'privchat-web',
    device_name: 'privchat-web',
    app_version: '0.0.0',
  };
}

function pseudoUuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
