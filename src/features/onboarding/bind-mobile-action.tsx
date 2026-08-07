// Required-action `bind_mobile`: when the platform sets `mobileRequired` and
// the account has no number yet, the server gates login with this action.
// Blocking page — no skip; mirrors BindInviteCodeAction's layout and
// completion contract.
//
// No SMS code by design: this is the first binding inside the registration
// flow, and inserting a verification round-trip would cut that flow in half.
// No format validation either — the server only checks for duplicates, so an
// extra client-side rule would just confuse users about what is accepted.
//
// Recommended, not required, so there is a way out — but it is deliberately
// quiet: a solid primary button to continue, and a small muted link below to
// skip. Binding a phone is a real benefit (plenty of users cannot recall the
// username they picked, and a phone number logs in far more easily), so the
// default path should be obvious and skipping should be available rather than
// offered as an equal choice.
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
import { LangSwitcher } from '@/components/lang-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { getRequiredActionsProvider } from '@/lib/account-required-actions-provider';
import { getActiveAccessToken } from '@/lib/active-access-token';

/** China only for now; switch to a picker when other regions are needed —
 *  the server stores the same single field either way. */
const CHINA_DIAL_CODE = '+86';

export interface BindMobileActionProps {
  /** Invoked AFTER the bind succeeds. Caller (gate) re-fetches the
   *  authoritative list to decide what to render next. */
  onCompleted: () => Promise<void> | void;
  /** Invoked when the user skips. Recommended action, not a required one —
   *  see the note on visual weight below. */
  onSkip: () => Promise<void> | void;
}

export function BindMobileAction({ onCompleted, onSkip }: BindMobileActionProps) {
  const { t } = useTranslation();
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = mobile.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await getRequiredActionsProvider(getActiveAccessToken).bindMobile(trimmed);
      await onCompleted();
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      setError(
        raw.includes('MOBILE_ALREADY_TAKEN')
          ? t('bind_mobile.err_taken')
          : raw.includes('MOBILE_ALREADY_BOUND')
            ? t('bind_mobile.err_bound')
            : raw.includes('INVALID_MOBILE')
              ? t('bind_mobile.err_invalid')
              : t('bind_mobile.err_failed'),
      );
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
          <CardTitle>{t('bind_mobile.title')}</CardTitle>
          <CardDescription>{t('bind_mobile.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-mobile">{t('bind_mobile.input_label')}</Label>
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                {CHINA_DIAL_CODE}
              </span>
              <Input
                id="onboarding-mobile"
                autoFocus
                value={mobile}
                onChange={(e) => setMobile(e.currentTarget.value)}
                placeholder={t('bind_mobile.input_ph')}
                maxLength={20}
                disabled={busy}
                data-testid="onboarding-mobile-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) void submit();
                }}
              />
            </div>
          </div>
          <Button
            variant="default"
            className="w-full"
            onClick={() => void submit()}
            disabled={busy || mobile.trim() === ''}
            data-testid="onboarding-mobile-submit"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('bind_mobile.binding')}
              </>
            ) : (
              t('bind_mobile.submit')
            )}
          </Button>
          {error !== null && (
            <p className="text-sm text-destructive" data-testid="onboarding-mobile-error">
              {error}
            </p>
          )}
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={() => void onSkip()}
            disabled={busy}
            data-testid="onboarding-mobile-skip"
          >
            {t('bind_mobile.skip')}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
