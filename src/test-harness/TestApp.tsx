// Alternate App entry used by Playwright smoke tests. Bypasses login,
// auto-login, and the real PrivchatClient construction; mounts the
// chat workspace directly with a mock adapter that the spec drives
// via `window.__privchatTest`.
//
// Gated by `import.meta.env.VITE_PRIVCHAT_TEST_MODE === 'mock'` —
// production builds drop the entire module via Vite's tree shaking
// because the env flag is statically false.
//
// R7.5: TestApp now mirrors App.tsx's multi-account state machine
// (`activeAccountKey`, `switching`, `addingAccount`) so smoke
// specs can assert on the real UI surface — switcher disabled
// state during a pending switch, add-account → LoginPage → Cancel
// → workspace transition, registry-driven re-render, etc. The
// state machine is intentionally minimal: it does NOT call any
// real `PrivchatClient` lifecycle (no connect / authenticate);
// the "switch" is just a setState. Production App.tsx is still the
// source of truth for full sequencer behaviour, covered by
// `tests/smoke/switch-sequencing.spec.ts`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PrivchatProvider } from '@privchat/react';
import { ChatWorkspace } from '@/features/chat/chat-workspace';
import { LoginPage } from '@/features/auth/login-page';
import { RequiredActionsGate } from '@/features/onboarding/required-actions-gate';
import { SessionExpiredDialog } from '@/features/auth/session-expired-dialog';
import type { PrivchatHandle } from '@/lib/privchat-client';
import {
  createTestAdapter,
  installTestControls,
  onTestSessionExpired,
} from './mock-adapter';
import {
  loadRegistry,
  subscribeRegistry,
} from '@/lib/account-registry-store';
import {
  clearSession,
  commitActiveAccount,
  persistSessionForAccount,
} from '@/lib/session-storage';
import type { AccountKey } from '@/lib/account-key';
import type { RequiredAction } from '@/lib/required-action';

declare global {
  interface Window {
    /** R7.5 — when set to `true` BEFORE clicking a switcher entry,
     *  TestApp's `onSelectAccount` will hold the pending switch
     *  open until `__privchatTestReleaseHeldSwitch()` is called.
     *  Lets specs assert on the in-flight `data-switching="1"`
     *  state without racing the resolution. */
    __privchatTestHoldNextSwitch?: boolean;
    /** R7.5 — release any held switch. Idempotent. */
    __privchatTestReleaseHeldSwitch?: () => void;
  }
}

export function TestApp() {
  const handle = useMemo(() => {
    installTestControls();
    const adapter = createTestAdapter();
    // ChatWorkspace no longer reads `handle.client`, so a typed-cast
    // empty stub is enough. We only need the `adapter` field to be a
    // real adapter so the provider works.
    const fakeHandle: PrivchatHandle = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
    };
    return fakeHandle;
  }, []);

  // Mirror App.tsx's three-axis state machine. We initialise from
  // the persisted registry so a Playwright spec that staged
  // localStorage in `addInitScript` sees the right active key on
  // first paint.
  const [activeAccountKey, setActiveAccountKey] = useState<AccountKey | null>(
    () => {
      const reg = loadRegistry();
      return reg?.active ?? null;
    },
  );
  const [switching, setSwitching] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  // Mirror App.tsx's session-expired surface: the SDK's terminal
  // `session_expired` event → re-login dialog. Driven in test mode by
  // `__privchatTest.fireSessionExpired()`.
  const [sessionExpired, setSessionExpired] = useState(false);
  // R8.4c — mirror App.tsx's fresh-login hint slot so the gate gets
  // immediate prefill when login lands with non-empty actions.
  const [initialActionsForKey, setInitialActionsForKey] = useState<{
    accountKey: AccountKey;
    actions: RequiredAction[];
  } | null>(null);

  // Resolver for held switches. Set by `onSelectAccount` when
  // `__privchatTestHoldNextSwitch === true`; cleared by
  // `__privchatTestReleaseHeldSwitch()`.
  const heldResolverRef = useRef<(() => void) | null>(null);

  // Subscribe to registry mutations so the active key follows
  // whatever the harness writes (including `saveRegistry` calls
  // from `addAccountEntry`, `simulateAccountSwitch`, etc.).
  useEffect(() => {
    const off = subscribeRegistry(() => {
      const reg = loadRegistry();
      setActiveAccountKey(reg?.active ?? null);
    });
    return off;
  }, []);

  useEffect(() => onTestSessionExpired(() => setSessionExpired(true)), []);

  // Install hold/release knob exactly once per mount. Defaults to
  // immediate-resolve so existing specs (R7.3) don't have to
  // opt-in.
  useEffect(() => {
    window.__privchatTestHoldNextSwitch = false;
    window.__privchatTestReleaseHeldSwitch = () => {
      const resolver = heldResolverRef.current;
      heldResolverRef.current = null;
      resolver?.();
    };
    return () => {
      window.__privchatTestHoldNextSwitch = false;
      window.__privchatTestReleaseHeldSwitch = undefined;
    };
  }, []);

  const onSelectAccount = useCallback(
    async (target: AccountKey) => {
      setSwitching(true);
      if (window.__privchatTestHoldNextSwitch === true) {
        window.__privchatTestHoldNextSwitch = false;
        await new Promise<void>((resolve) => {
          heldResolverRef.current = resolve;
        });
      }
      setActiveAccountKey(target);
      setSwitching(false);
    },
    [],
  );

  const onAddAccount = useCallback(() => {
    setAddingAccount(true);
  }, []);

  const onCancelAddAccount = useCallback(() => {
    setAddingAccount(false);
  }, []);

  if (addingAccount) {
    // Render the real LoginPage so specs hit the same DOM the
    // production add-account flow does. R8.3b / R8.4c: `onLoggedIn`
    // now mirrors App.tsx's success path far enough to write the
    // session blob + commit-active AND stash requiredActions for
    // the gate. Full sequencer behaviour (connect/dispose/rollback)
    // stays covered by `tests/smoke/switch-sequencing.spec.ts`.
    return (
      <LoginPage
        onLoggedIn={async (credentials, requiredActions) => {
          const accountKey = await persistSessionForAccount(credentials);
          commitActiveAccount(accountKey);
          setInitialActionsForKey({ accountKey, actions: requiredActions });
          setAddingAccount(false);
        }}
        onCancel={onCancelAddAccount}
      />
    );
  }

  // R8.4c — Required Actions gate. Specs that drive PLATFORM-mode
  // SMS-login through TestApp see the same gate / flow / unsupported
  // page as production App.tsx. BUILTIN paths fall through (gate
  // calls BuiltinRequiredActionsProvider.list() which returns []).
  const gateAccountKey = activeAccountKey;
  const gateInitialActions =
    gateAccountKey !== null && initialActionsForKey?.accountKey === gateAccountKey
      ? initialActionsForKey.actions
      : undefined;

  // When there's no active account (e.g. test boot with empty registry),
  // skip the gate entirely — there's nothing to evaluate against.
  if (gateAccountKey === null) {
    return (
      <>
        <SessionExpiredDialog
          open={sessionExpired}
          onConfirm={() => {
            clearSession();
            setSessionExpired(false);
          }}
        />
        <PrivchatProvider adapter={handle.adapter}>
          <ChatWorkspace
            handle={handle}
            onLogout={() => {
              /* no-op in test mode */
            }}
            activeAccountKey={activeAccountKey}
            onSelectAccount={onSelectAccount}
            onAddAccount={onAddAccount}
            switching={switching}
          />
        </PrivchatProvider>
      </>
    );
  }

  return (
    <>
      <SessionExpiredDialog
        open={sessionExpired}
        onConfirm={() => {
          // Mirror App.tsx: confirm clears session + dismisses. The
          // full logout (handle dispose / route to login) is a no-op in
          // test mode; dismissing the dialog is the observable contract.
          clearSession();
          setSessionExpired(false);
        }}
      />
      <RequiredActionsGate
        accountKey={gateAccountKey}
        initialActions={gateInitialActions}
        onLogout={() => {
          clearSession();
          setInitialActionsForKey(null);
        }}
      >
        <PrivchatProvider adapter={handle.adapter}>
          <ChatWorkspace
            handle={handle}
            onLogout={() => {
              /* no-op in test mode */
            }}
            activeAccountKey={activeAccountKey}
            onSelectAccount={onSelectAccount}
            onAddAccount={onAddAccount}
            switching={switching}
          />
        </PrivchatProvider>
      </RequiredActionsGate>
    </>
  );
}
