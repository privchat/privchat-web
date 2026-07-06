import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
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
import { CountrySelect } from '@/components/ui/country-select';
import { OtpInput, type OtpInputHandle } from '@/components/ui/otp-input';
import { ThemeToggle } from '@/components/theme-toggle';
import { LangSwitcher } from '@/components/lang-switcher';
import { getAuthProvider } from '@/lib/account-auth-provider';
import { brandConfig } from '@/lib/brand-config';
import { ensureBootstrap, getBootstrapGateway } from '@/lib/bootstrap';
import { useAccountCapabilities } from '@/lib/account-capabilities';
import { getPlatformBaseUrl } from '@/lib/account-mode';
import { getOrCreateDeviceId } from '@/lib/device-id';
import { getLoginErrorMessage } from '@/lib/login-error-message';
import type { RequiredAction } from '@/lib/required-action';
import type { PersistedSession } from '@/lib/session-storage';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  type CountryEntry,
} from '@/lib/country-codes';
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

  // 网关解析：调用方显式传入 > bootstrap(动态/缓存) > 品牌静态(BUILTIN) > 本地开发缺省。
  const [url, setUrl] = useState(
    initialUrl ?? getBootstrapGateway() ?? (brandConfig.gatewayUrl || 'ws://127.0.0.1:9080/'),
  );
  useEffect(() => {
    // PLATFORM：启动即拉 bootstrap；成功且用户没手工改过网关时刷新为下发值。
    void ensureBootstrap().then(() => {
      const g = getBootstrapGateway();
      if (g !== null && initialUrl === undefined) setUrl((prev) => (prev === g ? prev : g));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
          <CardTitle>{brandConfig.appName}</CardTitle>
          <CardDescription>{brandConfig.tagline !== '' ? brandConfig.tagline : t('login.description')}</CardDescription>
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

// ─────────── PLATFORM: two-step phone → OTP flow (Telegram-style) ──

/** OTP box count. Telegram uses 5; PrivChat uses 6 to match the
 *  server's 6-digit code length (and existing `sms_code_placeholder`
 *  copy). Change here and in `OtpInput` callers if the server moves. */
const OTP_LENGTH = 6;

function PlatformSmsForm({
  serverUrl,
  busy,
  setBusy,
  setError,
  onLoggedIn,
}: FormBranchProps) {
  const { t } = useTranslation();
  // Two-step state machine. 'phone' = country + national-number entry;
  // 'otp' = 6-digit code entry with auto-submit on complete. The form
  // intentionally does NOT preserve OTP across step back-navigation —
  // re-entering phone means re-arming the whole flow.
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [country, setCountry] = useState<CountryEntry>(() =>
    pickDefaultCountry(),
  );
  // National number (no dial code, no leading 0). Stored raw — we
  // strip non-digits at submit time so paste of "(010) 1234-5678"
  // works without forcing the user to clean it up.
  const [nationalNumber, setNationalNumber] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const otpRef = useRef<OtpInputHandle>(null);

  // Compose into E.164: +<dial><digits-only>. Used for the platform
  // sendSmsCode / loginWithSms calls and for E164_RE validation.
  const composedMobile = `+${country.dial}${nationalNumber.replace(/[^0-9]/g, '')}`;
  const phoneValid = E164_RE.test(composedMobile);

  // R8.3b — cooldown countdown for OTP resend. Same lifecycle as
  // before: interval cleared on unmount and on cooldown reaching 0
  // so a back-nav doesn't leave a dangling setState.
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

  const sendCode = async (
    options: { advanceOnSuccess: boolean },
  ): Promise<boolean> => {
    if (!phoneValid) {
      setError(t('login.error_invalid_mobile'));
      return false;
    }
    const baseUrl = getPlatformBaseUrl();
    if (baseUrl === null) {
      setError(t('login.error_config'));
      return false;
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
        mobile: composedMobile,
        scene: 'login',
      });
      setCooldown(
        Number.isFinite(result.cooldownSeconds) && result.cooldownSeconds > 0
          ? Math.floor(result.cooldownSeconds)
          : 60,
      );
      if (options.advanceOnSuccess) {
        setStep('otp');
        setSmsCode('');
      }
      return true;
    } catch (e) {
      setError(getLoginErrorMessage(e, 'send-sms', t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (code: string) => {
    if (!phoneValid) {
      setError(t('login.error_invalid_mobile'));
      return;
    }
    if (code.length !== OTP_LENGTH) return;
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
        mobile: composedMobile,
        smsCode: code,
        device: makeDevice(),
      });
      // R8.3b — PLATFORM session blob MUST carry account_mode +
      // platform_base_url + refresh_token (R7/R8 compat note).
      // R8.4c — also pass requiredActions so App.tsx can prime the
      // RequiredActionsGate without a list() round-trip on first paint.
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
      // Reset the OTP boxes on failure so user can retype without
      // a "looks correct but cached wrong" trap.
      otpRef.current?.clear();
      setSmsCode('');
      setBusy(false);
    }
    // No setBusy(false) on success — onLoggedIn unmounts this page.
  };

  if (step === 'phone') {
    return (
      <>
        <FormRow id="country" label={t('login.country_label')}>
          <CountrySelect
            value={country}
            onChange={setCountry}
            disabled={busy}
            data-testid="login-country-select"
          />
        </FormRow>
        <FormRow id="phone-number" label={t('login.phone_number_label')}>
          <Input
            id="phone-number"
            value={nationalNumber}
            onChange={(e) => setNationalNumber(e.currentTarget.value)}
            autoComplete="tel-national"
            inputMode="tel"
            placeholder={t('login.phone_number_placeholder')}
            disabled={busy}
            data-testid="login-phone-number-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && phoneValid && !busy) {
                void sendCode({ advanceOnSuccess: true });
              }
            }}
          />
        </FormRow>

        <Button
          variant="default"
          className="w-full"
          onClick={() => void sendCode({ advanceOnSuccess: true })}
          disabled={busy || !phoneValid}
          data-testid="login-phone-continue"
        >
          {busy ? t('login.sending_sms_code') : t('login.continue')}
        </Button>
      </>
    );
  }

  // step === 'otp'
  return (
    <>
      <div className="space-y-1.5 text-center">
        <p className="text-sm font-medium">{t('login.otp_step_title')}</p>
        <p className="text-xs text-muted-foreground">
          {t('login.otp_step_subtitle', { mobile: composedMobile })}
        </p>
      </div>

      <div className="py-2">
        <OtpInput
          ref={otpRef}
          value={smsCode}
          onChange={setSmsCode}
          length={OTP_LENGTH}
          disabled={busy}
          onComplete={(code) => void submit(code)}
          data-testid="login-otp"
        />
      </div>

      {busy && (
        <p className="text-center text-sm text-muted-foreground">
          {t('login.signing_in')}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setStep('phone');
            setSmsCode('');
            setError(null);
            otpRef.current?.clear();
          }}
          disabled={busy}
          data-testid="login-otp-back"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t('login.otp_back')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void sendCode({ advanceOnSuccess: false })}
          disabled={busy || cooldown > 0}
          data-testid="login-otp-resend"
        >
          {cooldown > 0
            ? t('login.resend_sms_code', { seconds: cooldown })
            : t('login.otp_resend_now')}
        </Button>
      </div>
    </>
  );
}

/** Pick the default country code at mount.
 *
 *  v1: just returns the curated default (China). Future enhancement:
 *  inspect `navigator.language` (`zh-CN` → CN, `vi` → VN, `en-US` → US,
 *  etc.) and look it up in COUNTRIES. Not done yet because the
 *  zh-CN-primary user base + the dev server's localPlatform profile
 *  both default to China anyway. */
function pickDefaultCountry(): CountryEntry {
  if (typeof navigator !== 'undefined') {
    const lang = (navigator.language || '').toLowerCase();
    // Quick wins for the languages we already i18n.
    if (lang.startsWith('vi')) {
      const vn = COUNTRIES.find((c) => c.code === 'VN');
      if (vn !== undefined) return vn;
    }
    if (lang.startsWith('en-us') || lang === 'en') {
      const us = COUNTRIES.find((c) => c.code === 'US');
      if (us !== undefined) return us;
    }
  }
  return DEFAULT_COUNTRY;
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
    // Persisted across reloads (localStorage) so the server recognizes the
    // same device and does not re-post a "new device login" notification on
    // every page refresh. Previously this was a fresh random UUID per login.
    device_id: getOrCreateDeviceId(),
    device_type: 'web',
    app_id: 'privchat-web',
    device_name: 'privchat-web',
    app_version: '0.0.0',
  };
}
