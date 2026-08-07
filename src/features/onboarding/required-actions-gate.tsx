// R8.4c — Required Actions UI gate.
//
// Wrapper component: between auth-success and ChatWorkspace. Decides
// based on the server's required-actions list whether to render the
// flow (block) or pass through to children (clear).
//
// Spec PLATFORM_REQUIRED_ACTIONS_CONTRACT §4 / §6. Implements:
//
//   - State machine: idle → loading → (clear | pending | unsupported)
//   - Server is authoritative: every gate evaluation calls
//     `RequiredActionsProvider.list()`. Local fallback flag (R8.4c
//     localStorage `privchat.web.required-actions-pending.<key>`) is
//     a hint only and auto-heals when the server says clear.
//   - Unknown required action (`!isHandlableAction(a.action) && isRequired(a)`)
//     → fail-closed Unsupported page (never silently pass).
//   - Fresh-login can short-circuit the first list() by passing
//     `initialActions` (from `LoginResult.requiredActions`); the gate
//     will still re-list in the background for a second confirmation.
//   - Network / 5xx on list() → fail-open (enter workspace, log
//     exception). Required-actions are not a security gate; flaking
//     server availability shouldn't strand users in a splash. The
//     next page load / refresh re-checks.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { AccountKey } from '@/lib/account-key';
import {
  getRequiredActionsProvider,
  type RequiredActionsProvider,
} from '@/lib/account-required-actions-provider';
import { getActiveAccessToken } from '@/lib/active-access-token';
import {
  isHandlableAction,
  isRequired,
  type RequiredAction,
} from '@/lib/required-action';
import {
  clearRequiredActionsPending,
  markRequiredActionsPending,
} from '@/lib/required-actions-pending';
import { captureException } from '@/lib/error-reporter';
import { CompleteProfileAction } from './complete-profile-action';
import { BindInviteCodeAction } from './bind-invite-code-action';
import { BindMobileAction } from './bind-mobile-action';
import { UnsupportedRequiredActionPage } from './unsupported-required-action-page';

export interface RequiredActionsGateProps {
  /** Active account this gate is evaluating for. localStorage flags and
   *  background list() are keyed by this. */
  accountKey: AccountKey;
  /** Optional immediate hint (fresh-login path). When set, the gate
   *  renders state derived from these actions on first paint, then
   *  re-lists in the background for the authoritative check. */
  initialActions?: RequiredAction[];
  /** Caller-supplied logout (Unsupported page's "Sign out" button). */
  onLogout: () => void | Promise<void>;
  /** Children = the post-gate UI (ChatWorkspace + providers tree).
   *  Only rendered when state.kind === 'clear'. */
  children: React.ReactNode;
}

type GateState =
  | { kind: 'loading' }
  | { kind: 'clear' }
  | { kind: 'pending'; actions: RequiredAction[] }
  | { kind: 'unsupported'; action: RequiredAction };

/** Reducer: server's list → state. Three rules (spec §4.3):
 *   - Empty list → clear
 *   - Any unknown action with `required` (incl. missing → defaults true)
 *     → unsupported (fail-closed; client cannot bypass)
 *   - Unknown actions with `required === false` → silent-skip (dropped
 *     entirely; not rendered, not blocked on)
 *   - Remaining known actions → pending (handler iterates head-first)
 */
function reduceActions(actions: RequiredAction[]): GateState {
  if (actions.length === 0) return { kind: 'clear' };
  // 1. Fail-closed sweep first: any unknown-and-required wins,
  //    regardless of position. Server-controlled ordering can put
  //    unknowns anywhere; reducer enforces the gate.
  const blocking = actions.find(
    (a) => !isHandlableAction(a.action) && isRequired(a),
  );
  if (blocking !== undefined) return { kind: 'unsupported', action: blocking };
  // 2. Keep only client-handlable actions. Unknown-and-optional are
  //    silent-skipped per spec — they were filtered out of the gate's
  //    work queue without rendering a placeholder UI.
  const handlable = actions.filter((a) => isHandlableAction(a.action));
  if (handlable.length === 0) return { kind: 'clear' };
  return { kind: 'pending', actions: handlable };
}

export function RequiredActionsGate({
  accountKey,
  initialActions,
  onLogout,
  children,
}: RequiredActionsGateProps) {
  const { t } = useTranslation();
  // Module-stable provider instance per build (cached by factory).
  const provider: RequiredActionsProvider = useMemo(
    () => getRequiredActionsProvider(getActiveAccessToken),
    [],
  );
  const [state, setState] = useState<GateState>(() =>
    initialActions !== undefined ? reduceActions(initialActions) : { kind: 'loading' },
  );

  // Re-check on accountKey change. Initial hint avoids first-paint flash
  // for fresh login; we still re-list to confirm.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const actions = await provider.list();
        if (cancelled) return;
        const next = reduceActions(actions);
        setState(next);
        if (next.kind === 'pending' || next.kind === 'unsupported') {
          markRequiredActionsPending(accountKey);
        } else {
          clearRequiredActionsPending(accountKey);
        }
      } catch (err) {
        if (cancelled) return;
        // Fail-open: don't strand users in splash on transient network
        // failures. Required actions aren't a security gate; the next
        // page load re-checks. Log for ops visibility.
        captureException(err, {
          source: 'required-actions-gate.list',
        });
        setState({ kind: 'clear' });
        clearRequiredActionsPending(accountKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountKey, provider]);

  const handleActionCompleted = async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const actions = await provider.list();
      const next = reduceActions(actions);
      setState(next);
      if (next.kind === 'pending' || next.kind === 'unsupported') {
        markRequiredActionsPending(accountKey);
      } else {
        clearRequiredActionsPending(accountKey);
      }
    } catch (err) {
      captureException(err, {
        source: 'required-actions-gate.after-action',
      });
      setState({ kind: 'clear' });
      clearRequiredActionsPending(accountKey);
    }
  };

  if (state.kind === 'loading') {
    return (
      <div
        className="relative min-h-screen flex items-center justify-center bg-muted text-muted-foreground"
        data-testid="required-actions-loading"
      >
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('onboarding.splash_loading')}
        </div>
      </div>
    );
  }

  if (state.kind === 'unsupported') {
    return (
      <UnsupportedRequiredActionPage
        action={state.action}
        onLogout={onLogout}
      />
    );
  }

  if (state.kind === 'pending') {
    // Dispatch by `action` machine name (head-of-queue first; completing
    // one re-lists, so the queue drains in server order).
    const head = state.actions[0]!;
    if (head.action === 'bind_mobile') {
      return (
        <BindMobileAction
          onCompleted={handleActionCompleted}
          // Skip is session-scoped: nothing is persisted, so the server will
          // offer it again next login. A recommendation should keep asking
          // gently, not vanish after one dismissal.
          onSkip={() => setState((s) =>
            s.kind === 'pending'
              ? ((rest) => (rest.length === 0
                  ? { kind: 'clear' as const }
                  : { kind: 'pending' as const, actions: rest }))(
                  s.actions.filter((a) => a.action !== 'bind_mobile'),
                )
              : s,
          )}
        />
      );
    }
    if (head.action === 'bind_invite_code') {
      return (
        <BindInviteCodeAction
          accountKey={accountKey}
          onCompleted={handleActionCompleted}
        />
      );
    }
    return (
      <CompleteProfileAction
        action={head}
        onCompleted={handleActionCompleted}
      />
    );
  }

  return <>{children}</>;
}
