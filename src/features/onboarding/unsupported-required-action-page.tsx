// R8.4c — fail-closed page when the server requires an action this build
// can't handle (PLATFORM_REQUIRED_ACTIONS_CONTRACT §4.3 / §4.4).
//
// Rendered when the gate's reducer finds a required action whose `action`
// machine name is NOT in `HANDLABLE_ACTIONS` AND `isRequired(a) === true`
// (the latter is the wire-defense default for missing `required`).
//
// **Page-level block**, not a dismissible modal. Two affordances only:
//   - Reload (after the user updates the build)
//   - Sign out

import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LangSwitcher } from '@/components/lang-switcher';
import { actionTitle } from '@/lib/required-action';
import type { RequiredAction } from '@/lib/required-action';

export interface UnsupportedRequiredActionPageProps {
  /** The unsupported action that triggered the block. UI shows its
   *  resolved title (titleKey i18n → server title → action machine
   *  name fallback). */
  action: RequiredAction;
  /** Caller-supplied logout. The page calls this; caller decides
   *  how to wind down (clear session, route to LoginPage, etc). */
  onLogout: () => void | Promise<void>;
}

export function UnsupportedRequiredActionPage({
  action,
  onLogout,
}: UnsupportedRequiredActionPageProps) {
  const { t } = useTranslation();
  const titleResolved = actionTitle(action, t);
  // If actionTitle returned the action machine name (no title /
  // titleKey from server), fall back to the generic message so the
  // user doesn't see a raw "complete_kyc" string.
  const message =
    titleResolved === action.action
      ? t('onboarding.unsupported.message_fallback')
      : t('onboarding.unsupported.message', { title: titleResolved });

  return (
    <div
      className="relative min-h-screen flex items-center justify-center bg-muted p-6"
      data-testid="unsupported-required-action"
    >
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <LangSwitcher />
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('onboarding.unsupported.title')}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="default"
            className="w-full"
            onClick={() => window.location.reload()}
            data-testid="unsupported-reload"
          >
            {t('onboarding.unsupported.reload')}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void onLogout()}
            data-testid="unsupported-logout"
          >
            {t('onboarding.unsupported.logout')}
          </Button>
          {import.meta.env.DEV && (
            // Dev-only diagnostic: full machine name for debugging.
            // Production hides this so users don't see jargon.
            <p className="text-xs text-muted-foreground pt-2">
              dev: unsupported action = <code>{action.action}</code>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
