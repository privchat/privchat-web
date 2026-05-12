// R8.4c — `complete_profile` action handler.
//
// v1 only supports the `nickname` field. R8.4d will reuse this component
// and extend to additional fields (avatar / bio / gender / birthday).
//
// Submit path goes through `ProfileProvider.updateNickname()` — the
// SOLE entry for nickname updates (PLATFORM_PROFILE_HTTP_CONTRACT §2.1).
// On success the caller (RequiredActionsGate) re-fetches the authoritative
// actions list; we DO NOT assume completion locally.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
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
import { getProfileProvider } from '@/lib/account-profile-provider';
import { getActiveAccessToken } from '@/lib/active-access-token';
import { captureException } from '@/lib/error-reporter';
import type { RequiredAction } from '@/lib/required-action';

export interface CompleteProfileActionProps {
  /** The current `complete_profile` action from the server. UI uses
   *  `action.fields` to know which sub-fields are required; v1 only
   *  acts on `'nickname'`, silently ignores unknown field tags. */
  action: RequiredAction;
  /** Invoked AFTER `updateNickname()` succeeds. Caller (gate) re-fetches
   *  the authoritative list to decide whether to stay on this page,
   *  show another action, or enter ChatWorkspace. */
  onCompleted: () => Promise<void> | void;
}

export function CompleteProfileAction({
  action,
  onCompleted,
}: CompleteProfileActionProps) {
  const { t } = useTranslation();
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // v1: only `nickname` is supported. Spec PLATFORM_REQUIRED_ACTIONS_CONTRACT §7.1
  // — if server pushes additional fields (e.g. ['nickname','avatar']) we
  // still render the nickname form and silently ignore the rest; R8.4d will
  // extend. If server pushes ONLY unknown fields (no 'nickname'), the
  // gate's reducer routes to the unsupported page before we reach here.
  void action;

  const submit = async () => {
    const trimmed = nickname.trim();
    if (trimmed === '') {
      setError(t('onboarding.complete_profile.error_required'));
      return;
    }
    if (trimmed.length < 2) {
      setError(t('onboarding.complete_profile.error_too_short'));
      return;
    }
    if (trimmed.length > 32) {
      setError(t('onboarding.complete_profile.error_too_long'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const provider = getProfileProvider(getActiveAccessToken);
      // updateNickname is required on the interface (non-optional) per
      // R8.4b; both BUILTIN (throws) and PLATFORM (HTTP) implement it.
      // The gate only mounts this component under PLATFORM mode in
      // practice, so the throw branch is defensive.
      await provider.updateNickname(trimmed);
      // R8.4c invariant: do NOT assume "the gate is now clear". Hand
      // control back to the gate which re-fetches list().
      await onCompleted();
    } catch (e) {
      const errName = e instanceof Error ? e.name : 'Error';
      const errMessage = e instanceof Error ? e.message : String(e);
      setError(translateError(errName, errMessage, t));
      captureException(e, { source: 'onboarding.complete_profile.submit' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-muted p-6">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <LangSwitcher />
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('onboarding.complete_profile.title')}</CardTitle>
          <CardDescription>
            {t('onboarding.complete_profile.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-nickname">
              {t('onboarding.complete_profile.nickname_label')}
            </Label>
            <Input
              id="onboarding-nickname"
              autoFocus
              value={nickname}
              onChange={(e) => setNickname(e.currentTarget.value)}
              placeholder={t('onboarding.complete_profile.nickname_placeholder')}
              disabled={busy}
              data-testid="onboarding-nickname-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void submit();
              }}
            />
          </div>
          <Button
            variant="default"
            className="w-full"
            onClick={() => void submit()}
            disabled={busy}
            data-testid="onboarding-nickname-submit"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('onboarding.complete_profile.submitting')}
              </>
            ) : (
              t('onboarding.complete_profile.submit')
            )}
          </Button>
          {error !== null && (
            <p
              className="text-sm text-destructive"
              data-testid="onboarding-error"
            >
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Map provider error class names to a user-facing string. Reuses the
 *  R8.3a error taxonomy (`PlatformError`s) for consistency with LoginPage. */
function translateError(
  name: string,
  message: string,
  t: (k: string) => string,
): string {
  switch (name) {
    case 'PlatformApiError':
      // Server message is already user-facing per envelope convention.
      return message;
    case 'PlatformHttpError':
      return t('onboarding.complete_profile.error_network');
    case 'PlatformProtocolError':
      return t('onboarding.complete_profile.error_protocol');
    case 'PlatformConfigError':
      return t('onboarding.complete_profile.error_config');
    default:
      return message;
  }
}
