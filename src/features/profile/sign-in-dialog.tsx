// Daily sign-in (签到) dialog. PLATFORM mode only — the entry point is
// gated on the dedicated `capability.memberSignIn` flag.
//
// Shows: today's signed state, streak/total summary, the configured
// reward tiers (points per streak day), and a Sign-in button. On a
// successful sign-in we re-fetch the summary so the streak + today
// flag update immediately and surface the points just earned.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { usePrivchatClient } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  getMemberSignInProvider,
  type MemberSignInProvider,
  type SignInConfig,
  type SignInRecord,
  type SignInSummary,
} from '@/lib/member-sign-in-provider';
import { getActiveAccessToken } from '@/lib/active-access-token';
import { captureException } from '@/lib/error-reporter';
import { errorText } from '@/features/chat/error-text';
import { fenToYuan } from '@/lib/platform-wallet-provider';

export interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignInDialog({ open, onOpenChange }: SignInDialogProps) {
  const { t } = useTranslation();
  const adapter = usePrivchatClient();
  const selfUid = adapter.sessionSnapshot().user_id;
  const [provider] = useState<MemberSignInProvider>(() =>
    getMemberSignInProvider(getActiveAccessToken),
  );

  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SignInSummary | null>(null);
  const [configs, setConfigs] = useState<SignInConfig[]>([]);
  // Points awarded on the most recent successful sign-in this session,
  // surfaced as a short "+N" confirmation flash.
  const [justEarned, setJustEarned] = useState<SignInRecord | null>(null);

  // Load summary + configs when opened; clear when closed so a re-open
  // re-fetches (multi-account isolation).
  useEffect(() => {
    if (!open) {
      setLoading(true);
      setSummary(null);
      setConfigs([]);
      setError(null);
      setJustEarned(null);
      return;
    }
    if (selfUid === undefined) {
      setError(t('sign_in.no_session'));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      provider.getSummary(selfUid),
      provider.listConfigs(),
    ])
      .then(([summaryRes, configsRes]) => {
        if (cancelled) return;
        if (summaryRes.status === 'fulfilled') {
          setSummary(summaryRes.value);
        } else {
          setError(errorText(summaryRes.reason));
        }
        if (configsRes.status === 'fulfilled') {
          setConfigs(
            configsRes.value
              .filter((c) => c.status === 1)
              .sort((a, b) => a.day - b.day),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, provider, selfUid, t]);

  const onSignIn = async () => {
    if (signing || selfUid === undefined) return;
    setSigning(true);
    setError(null);
    try {
      const record = await provider.signIn(selfUid);
      setJustEarned(record);
      // Re-pull the canonical summary so streak / today flag are exact.
      try {
        setSummary(await provider.getSummary(selfUid));
      } catch {
        // Non-fatal — optimistically flip todaySigned if the refetch
        // fails so the button doesn't invite a duplicate sign-in.
        setSummary((prev) =>
          prev !== null ? { ...prev, todaySigned: true } : prev,
        );
      }
    } catch (e) {
      captureException(e, { source: 'sign-in.create' });
      setError(`${t('sign_in.sign_failed')}: ${errorText(e)}`);
    } finally {
      setSigning(false);
    }
  };

  const todaySigned = summary?.todaySigned === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sign_in.title')}</DialogTitle>
        </DialogHeader>
        {error !== null && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {summary !== null && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-center">
                  <div className="text-lg font-semibold">
                    {summary.continuousDay}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t('sign_in.continuous_days')}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-center">
                  <div className="text-lg font-semibold">
                    {summary.totalDay}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t('sign_in.total_days')}
                  </div>
                </div>
              </div>
            )}

            {justEarned !== null && (
              <div className="flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                <span>{t('sign_in.earned', { points: justEarned.point })}</span>
                {justEarned.cashAmount > 0 && (
                  <span>+{fenToYuan(justEarned.cashAmount)}</span>
                )}
              </div>
            )}

            {configs.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase text-muted-foreground">
                  {t('sign_in.rewards_heading')}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {configs.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-md border bg-muted/10 px-1 py-1.5 text-center"
                    >
                      <div className="text-[10px] text-muted-foreground">
                        {t('sign_in.day_label', { day: c.day })}
                      </div>
                      <div className="text-xs font-medium">
                        {t('sign_in.points', { points: c.point })}
                      </div>
                      {c.cashAmount > 0 && (
                        <div className="text-[10px] font-medium text-emerald-600">
                          +{fenToYuan(c.cashAmount)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button
              className="w-full"
              disabled={signing || todaySigned}
              onClick={() => void onSignIn()}
              data-testid="sign-in-button"
            >
              {signing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : todaySigned ? (
                t('sign_in.already_signed')
              ) : (
                t('sign_in.sign_now')
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
