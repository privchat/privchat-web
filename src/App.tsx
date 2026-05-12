import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectionState } from '@privchat/react';
import { AppProviders } from '@/app/providers';
import { LoginPage } from '@/features/auth/login-page';
import { ChatWorkspace } from '@/features/chat/chat-workspace';
import { RequiredActionsGate } from '@/features/onboarding/required-actions-gate';
import type { PrivchatHandle } from '@/lib/privchat-client';
import type { RequiredAction } from '@/lib/required-action';
import {
  clearSession,
  commitActiveAccount,
  loadSession,
  persistSessionForAccount,
  type PersistedSession,
} from '@/lib/session-storage';
import { migrateLegacySessionToRegistryOfOne } from '@/lib/migrate-single-account-session';
import { connectAccount } from '@/lib/connect-account';
import { captureException } from '@/lib/error-reporter';
import {
  getActiveAccountKey,
  setActiveAccountKey,
} from '@/lib/active-account';
import { loadAccountSession } from '@/lib/account-session';
import { loadRegistry } from '@/lib/account-registry-store';
import type { AccountKey } from '@/lib/account-key';
import {
  switchAccountSafely,
  type SwitchOutcome,
} from '@/lib/switch-account';
import { clearForAccountSwitch as stopVoiceForSwitch } from '@/features/chat/voice-playback';
import { abortAllForAccountSwitch as abortUploadsForSwitch } from '@/features/chat/uploads-store';

type AutoLoginState = 'restoring' | 'idle';

export default function App() {
  const [handle, setHandle] = useState<PrivchatHandle | null>(null);
  const [autoLogin, setAutoLogin] = useState<AutoLoginState>('restoring');
  // R7.3 — when true, render LoginPage with a Cancel button so the
  // user can return to the previous active account without
  // creating a new one. Set by AccountSwitcher's "Add account"
  // entry; cleared on cancel or successful login.
  const [addingAccount, setAddingAccount] = useState(false);
  // R7.3 — `accountKey` of whichever entry is currently the live
  // session. Drives `<PrivchatProvider key={...}>` so a switch
  // unmounts and remounts the entire chat subtree, plus feeds the
  // sidebar AccountSwitcher's "active checkmark". Mirrors what the
  // active-account seam already publishes; we keep a React state
  // copy so UI re-renders.
  const [activeAccountKey, setActiveAccountKeyState] =
    useState<AccountKey | null>(null);
  // R7.4 — true while a switch sequencer is in flight. Disables
  // the AccountSwitcher trigger so the user can't queue another
  // switch mid-flight (which would race connect/dispose). Cleared
  // by every terminal sequencer outcome (committed / rolled-back /
  // rejected / failed).
  const [switching, setSwitching] = useState(false);
  // R8.4c — fresh-login's first-paint hint for the RequiredActionsGate.
  // When fresh login lands with non-empty `requiredActions`, we stash
  // them so the gate can render immediately without a list() round-trip
  // (and the gate still re-lists to confirm). Cleared once it's consumed
  // (i.e. accountKey no longer matches), since other paths (auto-login,
  // switch) don't have an immediate hint.
  const [initialActionsForKey, setInitialActionsForKey] = useState<{
    accountKey: AccountKey;
    actions: RequiredAction[];
  } | null>(null);

  // Auto-login from persisted session on mount.
  //
  // R7.2a: before reading the persisted session, run the legacy →
  // registry-of-one migration. Already-migrated installs short-
  // circuit at the first localStorage read.
  // R7.2b: legacy → account-DB copy runs inside `connectAccount`.
  // R7.3: this useEffect now fully delegates to `connectAccount`,
  // which is also reused by fresh-login and switch-account.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const accountKey = await migrateLegacySessionToRegistryOfOne();
      if (cancelled) return;
      const persisted = loadSession();
      if (persisted === null) {
        setAutoLogin('idle');
        return;
      }
      try {
        const { handle: next, accountKey: connectedKey } =
          await connectAccount(persisted);
        if (cancelled) {
          await next.client.dispose().catch(() => {});
          return;
        }
        setHandle(next);
        setActiveAccountKeyState(connectedKey);
      } catch (err) {
        // Stale token / bad URL / server down — wipe and fall back to login.
        captureException(err, { source: 'app.auto-login' });
        clearSession();
      } finally {
        if (!cancelled) {
          setAutoLogin('idle');
        }
      }
      void accountKey;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (handle !== null) {
      // Dev-only: cache inspection hatch (RPC is over WebSocket so
      // DevTools Network can't read payloads):
      //   window.__privchat.cachedChannels()
      //   window.__privchat.getCachedMessages('1112', 1)
      //   window.__privchat.sessionSnapshot()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__privchat = handle.client;
    }
    return () => {
      if (handle !== null) {
        // dispose() is idempotent and swallows transport errors.
        void handle.client.dispose();
      }
    };
  }, [handle]);

  /** Fresh-login + add-account converge here. Both come in with
   *  credentials — fresh-login from the auto-login fallback,
   *  add-account from the switcher.
   *
   *  R7.4 splits into two phases:
   *
   *    Phase A (persist):
   *      - derive the AccountKey
   *      - write the namespaced session blob
   *      - upsert the registry entry
   *      - DO NOT flip `registry.active` or the active-account
   *        seam yet
   *
   *    Phase B (sequence into active):
   *      - same `switchAccountSafely` the switcher uses
   *      - on success → commit active = new account, swap handle
   *      - on failure → rollback to whichever account was active
   *        before (if any), keep the new entry persisted for a
   *        retry from the switcher
   *
   *  Persisting before connect means a flaky network on the very
   *  first login still leaves the entry recoverable from the
   *  switcher (or from the next reload's auto-login). */
  const onLoggedIn = useCallback(
    async (
      credentials: Omit<PersistedSession, 'saved_at'>,
      requiredActions: RequiredAction[],
    ) => {
      setAutoLogin('restoring');
      setSwitching(true);
      let targetKey: AccountKey;
      try {
        targetKey = await persistSessionForAccount(credentials);
      } catch (err) {
        captureException(err, { source: 'app.fresh-login.persist' });
        setAutoLogin('idle');
        setSwitching(false);
        return;
      }
      // R8.4c: stash LoginResult's requiredActions so the gate can
      // render its first paint without a list() round-trip. Gate will
      // still re-list for authoritative confirmation.
      setInitialActionsForKey({ accountKey: targetKey, actions: requiredActions });

      const oldHandle = handle;
      const oldKey = activeAccountKey;
      setHandle(null);

      const outcome = await switchAccountSafely<PrivchatHandle>({
        current:
          oldHandle !== null && oldKey !== null
            ? { key: oldKey, handle: oldHandle }
            : null,
        targetKey,
        loadSession: (key) => loadAccountSession(key),
        connectAccount: async (session) => {
          const { handle: next } = await connectAccount(session);
          return next;
        },
        disconnectHandle: (h) => h.client.disconnect(),
        disposeHandle: (h) => h.client.dispose(),
        runtimeCleanup: () => {
          stopVoiceForSwitch();
          abortUploadsForSwitch('account switched');
        },
        commit: (key, h) => {
          commitActiveAccount(key);
          setHandle(h);
          setActiveAccountKeyState(key);
          setAddingAccount(false);
        },
        rollbackToCurrent: (key, h) => {
          commitActiveAccount(key);
          setHandle(h);
          setActiveAccountKeyState(key);
          // Stay in add-account mode so the user sees the error
          // context (registry entry was saved; they can retry from
          // the switcher).
          setAddingAccount(false);
        },
        fail: () => {
          clearSession();
          setHandle(null);
          setActiveAccountKeyState(null);
          setAddingAccount(false);
        },
        onError: (err, source) => captureException(err, { source }),
      });

      void outcome;
      setAutoLogin('idle');
      setSwitching(false);
    },
    [handle, activeAccountKey],
  );

  const onLogout = useCallback(async () => {
    clearSession();
    if (handle !== null) {
      await handle.client.dispose().catch(() => {});
    }
    setHandle(null);
    setActiveAccountKeyState(null);
  }, [handle]);

  /** R7.4 sequenced switch:
   *
   *    1. validate target session
   *    2. setSwitching(true) (UI lockout)
   *    3. runtimeCleanup (voice / uploads)
   *    4. disconnect old (1s timeout) + dispose
   *    5. connect target — only on success do we commit
   *    6. commit: write registry.active + active-account seam +
   *       React state (handle / activeAccountKey)
   *    7. on connect failure: try to reconnect old, restore React
   *       state to current; if old also fails, fall back to login
   *
   *  Crucially, `registry.active` and the active-account seam are
   *  NEVER flipped before step 5 succeeds — a half-completed
   *  switch can't leave the user looking at account A but writing
   *  per-account state under account B's bucket. */
  const onSelectAccount = useCallback(
    async (targetKey: AccountKey) => {
      if (targetKey === activeAccountKey) return;
      if (switching) return; // ignore double-clicks
      const reg = loadRegistry();
      if (reg === null || reg.accounts[targetKey] === undefined) {
        captureException(
          new Error(`onSelectAccount: unknown account ${targetKey}`),
          { source: 'app.switch-account' },
        );
        return;
      }

      setSwitching(true);
      setAutoLogin('restoring');
      // Snapshot the live React handle for the sequencer; clear
      // React state so any UI rerender during the switch doesn't
      // try to use a half-disposed client.
      const oldHandle = handle;
      const oldKey = activeAccountKey;
      setHandle(null);

      const outcome: SwitchOutcome<PrivchatHandle> =
        await switchAccountSafely<PrivchatHandle>({
          current:
            oldHandle !== null && oldKey !== null
              ? { key: oldKey, handle: oldHandle }
              : null,
          targetKey,
          loadSession: (key) => loadAccountSession(key),
          connectAccount: async (session) => {
            const { handle: next } = await connectAccount(session);
            return next;
          },
          disconnectHandle: (h) => h.client.disconnect(),
          disposeHandle: (h) => h.client.dispose(),
          runtimeCleanup: () => {
            stopVoiceForSwitch();
            abortUploadsForSwitch('account switched');
          },
          commit: (key, h) => {
            commitActiveAccount(key);
            setHandle(h);
            setActiveAccountKeyState(key);
          },
          rollbackToCurrent: (key, h) => {
            // `commitActiveAccount(key)` not strictly needed (we
            // never flipped active away from `key`), but call it
            // anyway so the in-memory seam is in known-good state
            // even if any prior code path left it dirty.
            commitActiveAccount(key);
            setHandle(h);
            setActiveAccountKeyState(key);
          },
          fail: () => {
            // Both target connect AND old reconnect failed (or
            // there was no old to recover). Drop to login.
            clearSession();
            setHandle(null);
            setActiveAccountKeyState(null);
          },
          onError: (err, source) => captureException(err, { source }),
        });

      void outcome;
      setAutoLogin('idle');
      setSwitching(false);
    },
    [handle, activeAccountKey, switching],
  );

  const onAddAccount = useCallback(() => {
    // Switch UI to "add" mode. We do NOT dispose the current handle
    // here — keep the active account live in the background while
    // the user fills in the form. Cancel returns them to the
    // existing chat; success goes through `onLoggedIn` which
    // disposes the old handle as part of the swap.
    setAddingAccount(true);
  }, []);

  const onCancelAddAccount = useCallback(() => {
    setAddingAccount(false);
    // If we got here without a live handle (no fallback to return
    // to), bounce back to the active-account seam so the next
    // mount tries auto-login again. With a handle alive, we just
    // re-render the existing workspace.
    if (handle === null) {
      // Restore the active-account seam to whatever the registry
      // says (in case Add was triggered from a partially-broken
      // state).
      const reg = loadRegistry();
      if (reg?.active !== undefined && reg.active !== null) {
        setActiveAccountKey(reg.active);
      }
    }
  }, [handle]);

  if (autoLogin === 'restoring') return <RestoringSplash />;

  // Login flow — fresh login (no handle, no registry entries) OR
  // add-account (handle exists, but user explicitly asked to add).
  if (handle === null || addingAccount) {
    return (
      <LoginPage
        onLoggedIn={onLoggedIn}
        onCancel={addingAccount ? onCancelAddAccount : undefined}
      />
    );
  }

  // R8.4c — Required Actions gate. Wraps ChatWorkspace + providers so:
  //   - PLATFORM users with pending actions see the action flow (not the
  //     chat UI) until they finish.
  //   - BUILTIN users pass straight through (BuiltinRequiredActionsProvider
  //     returns [] without HTTP).
  // Gate keys by `activeAccountKey` (or the active-account seam fallback)
  // so multi-account switches re-evaluate without remembering prior
  // account's actions.
  const gateAccountKey = activeAccountKey ?? getActiveAccountKey();
  const gateInitialActions =
    initialActionsForKey?.accountKey === gateAccountKey
      ? initialActionsForKey.actions
      : undefined;

  return (
    <RequiredActionsGate
      accountKey={gateAccountKey}
      initialActions={gateInitialActions}
      onLogout={() => void onLogout()}
    >
      <AppProviders
        handle={handle}
        // R7.3 — keying the provider subtree on the active account
        // forces a clean unmount + remount when the user switches
        // accounts. Every per-account hook (cached profiles,
        // channel list, conversation panel) starts from a fresh
        // subscription against the new adapter.
        providerKey={gateAccountKey}
      >
        <PostClientRoot
          handle={handle}
          onLogout={onLogout}
          activeAccountKey={activeAccountKey}
          onSelectAccount={onSelectAccount}
          onAddAccount={onAddAccount}
          switching={switching}
        />
      </AppProviders>
    </RequiredActionsGate>
  );
}

/** Lives under PrivchatProvider — can use `useConnectionState`. */
function PostClientRoot({
  handle,
  onLogout,
  activeAccountKey,
  onSelectAccount,
  onAddAccount,
  switching,
}: {
  handle: PrivchatHandle;
  onLogout: () => void;
  activeAccountKey: AccountKey | null;
  onSelectAccount: (key: AccountKey) => void;
  onAddAccount: () => void;
  switching: boolean;
}) {
  const state = useConnectionState();
  if (state === 'authenticated') {
    return (
      <ChatWorkspace
        handle={handle}
        onLogout={onLogout}
        activeAccountKey={activeAccountKey}
        onSelectAccount={onSelectAccount}
        onAddAccount={onAddAccount}
        switching={switching}
      />
    );
  }
  // Connection broke after auto-login (server kicked us, network dropped).
  // Easiest recovery is to wipe the bad session and let the user log in
  // again — handle.client is in a bad state and not worth salvaging.
  return <RestoringSplash />;
}

function RestoringSplash() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-sm text-muted-foreground">{t('app.loading')}</div>
    </div>
  );
}
