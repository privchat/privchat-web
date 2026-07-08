// Required-action `bind_invite_code` (spec MEMBER_INVITE_CODE §5.0 v2):
// when the platform sets `inviteCodeRequired` and the account has no
// binding yet, the server gates login with this action. Blocking page —
// no skip; mirrors CompleteProfileAction's layout and completion contract.
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
import type { AccountKey } from '@/lib/account-key';
import { loadRegistry } from '@/lib/account-registry-store';
import { bindInviteCode } from '@/lib/platform-invite-provider';

export interface BindInviteCodeActionProps {
  /** Active account — used to resolve the platform userId for the bind call. */
  accountKey: AccountKey;
  /** Invoked AFTER bind succeeds. Caller (gate) re-fetches the
   *  authoritative list to decide what to render next. */
  onCompleted: () => Promise<void> | void;
}

export function BindInviteCodeAction({
  accountKey,
  onCompleted,
}: BindInviteCodeActionProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = code.trim();
    if (trimmed === '' || busy) return;
    const userId = loadRegistry()?.accounts[accountKey]?.user_id ?? '';
    if (userId === '') {
      setError(t('invite.err_failed'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bindInviteCode(userId, trimmed);
      await onCompleted();
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      setError(
        raw.includes('INVITE_ALREADY_BOUND')
          ? t('invite.err_already')
          : raw.includes('INVITE_CODE')
            ? t('invite.err_invalid')
            : t('invite.err_failed'),
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
          <CardTitle>{t('invite.title')}</CardTitle>
          <CardDescription>{t('invite.required_subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-invite-code">{t('invite.input_ph')}</Label>
            <Input
              id="onboarding-invite-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              placeholder={t('invite.input_ph')}
              maxLength={32}
              disabled={busy}
              data-testid="onboarding-invite-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void submit();
              }}
            />
          </div>
          <Button
            variant="default"
            className="w-full"
            onClick={() => void submit()}
            disabled={busy || code.trim() === ''}
            data-testid="onboarding-invite-submit"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('invite.binding')}
              </>
            ) : (
              t('invite.bind_btn')
            )}
          </Button>
          {error !== null && (
            <p className="text-sm text-destructive" data-testid="onboarding-invite-error">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
