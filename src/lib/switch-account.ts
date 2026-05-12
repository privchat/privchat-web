// R7.4 — pure switch sequencer. Coordinates the
// stop-runtime → disconnect-old → connect-new → commit-on-success
// (or rollback) flow without owning any React state. The caller
// supplies callbacks for runtime cleanup, transport ops, and
// commit/rollback bookkeeping; the sequencer guarantees the
// ordering and the rollback semantics R7.4 requires.
//
// Why pure: testable in isolation. Tests inject mock connect /
// disconnect / runtimeCleanup that succeed or fail deterministically;
// production wires the real `connectAccount`, `client.disconnect`,
// `clearForAccountSwitch`, etc.

import type { AccountKey } from './account-key';
import { disconnectWithTimeout } from './disconnect-with-timeout';
import type { PersistedSession } from './session-storage';

/** Outcome of one switch attempt. The caller uses this for
 *  telemetry / rollback UI; the sequencer has already invoked
 *  the appropriate commit / rollback callback by the time this
 *  resolves. */
export type SwitchOutcome<H> =
  | {
      result: 'committed';
      accountKey: AccountKey;
      handle: H;
    }
  | {
      result: 'rolled-back-current';
      accountKey: AccountKey;
      handle: H;
    }
  | {
      result: 'rolled-back-no-current';
    }
  | {
      result: 'rejected';
      reason: 'no-target-session';
    };

export interface SwitchInputs<H> {
  /** The currently active handle + key, if any. `null` when this
   *  is a switch from "no active account" (e.g. add-account flow
   *  whose user just logged in for the first time). */
  current: { key: AccountKey; handle: H } | null;
  targetKey: AccountKey;
  /** Read the persisted session for any registered account.
   *  Returns null when the session blob is missing — the
   *  sequencer treats this as a hard reject (target was likely
   *  removed concurrently). */
  loadSession: (key: AccountKey) => PersistedSession | null;
  /** Construct + connect + authenticate a new handle for the
   *  given session. Throws on any of the three steps; sequencer
   *  catches and rolls back. */
  connectAccount: (session: PersistedSession) => Promise<H>;
  /** Graceful disconnect on the current handle. Wrapped by
   *  `disconnectWithTimeout` — if it doesn't resolve within
   *  `disconnectTimeoutMs` we move on. */
  disconnectHandle: (handle: H) => Promise<unknown>;
  /** Hard disposal — called after the timed disconnect, regardless
   *  of disconnect outcome, so a wedged client can't keep its
   *  websocket alive in the background. */
  disposeHandle: (handle: H) => Promise<unknown>;
  /** Called BEFORE disconnect-old. Tear down per-process side
   *  effects that don't belong to either account: the singleton
   *  voice-playback Audio, in-flight upload XHRs, etc. */
  runtimeCleanup: () => void;
  /** Called only on success. Persists `targetKey` as the
   *  registry's active + sets the in-memory active-account seam.
   *  React-state setters (setHandle / setActiveAccountKeyState)
   *  also live here. */
  commit: (key: AccountKey, handle: H) => void;
  /** Called when the target connect failed but we successfully
   *  reconnected the previous active. The caller should restore
   *  React state (setHandle = restored, active = current.key) +
   *  surface a UI error for the failed switch. */
  rollbackToCurrent: (key: AccountKey, handle: H) => void;
  /** Called when target failed AND we couldn't recover the old
   *  one (or there was no old). Caller should fall back to the
   *  login splash + clear React handle state. */
  fail: () => void;
  /** Diagnostic sink for any caught throw. */
  onError: (err: unknown, source: string) => void;
  /** Bound on the graceful disconnect window. Defaults to 1s. */
  disconnectTimeoutMs?: number;
}

export async function switchAccountSafely<H>(
  input: SwitchInputs<H>,
): Promise<SwitchOutcome<H>> {
  const targetSession = input.loadSession(input.targetKey);
  if (targetSession === null) {
    return { result: 'rejected', reason: 'no-target-session' };
  }

  // 1. Tear down per-process side effects BEFORE any disconnect.
  // Voice playback / uploads belong to the leaving account; doing
  // this first means even if disconnect / dispose hangs, the
  // user-facing state is already clean.
  try {
    input.runtimeCleanup();
  } catch (err) {
    input.onError(err, 'switch.runtime-cleanup');
  }

  // 2. Disconnect-then-dispose the current handle, with bounded
  // wait. We do BOTH disconnect AND dispose: a graceful close
  // first (clean server unsubscribe) then a hard dispose (frees
  // the Dexie handle + websocket reader regardless of how the
  // disconnect ended).
  if (input.current !== null) {
    const outcome = await disconnectWithTimeout(
      () => input.disconnectHandle(input.current!.handle),
      input.disconnectTimeoutMs ?? 1000,
    );
    if (outcome === 'error') {
      input.onError(
        new Error('current handle disconnect threw'),
        'switch.disconnect-current',
      );
    }
    try {
      await input.disposeHandle(input.current.handle);
    } catch (err) {
      input.onError(err, 'switch.dispose-current');
    }
  }

  // 3. Connect target. Failure here is the rollback trigger.
  let targetHandle: H;
  try {
    targetHandle = await input.connectAccount(targetSession);
  } catch (err) {
    input.onError(err, 'switch.connect-target');
    return rollbackAfterTargetFail(input);
  }

  // 4. Commit. From here on the switch is final; the caller's
  // commit callback writes registry.active + active-account seam +
  // React state. Anything that throws inside commit is the
  // caller's bug, not the sequencer's.
  try {
    input.commit(input.targetKey, targetHandle);
  } catch (err) {
    // Best-effort cleanup: if the commit threw after we
    // successfully connected the new handle, dispose it so it
    // doesn't leak. Then surface the error to fail().
    input.onError(err, 'switch.commit');
    try {
      await input.disposeHandle(targetHandle);
    } catch {
      /* swallowed */
    }
    return rollbackAfterTargetFail(input);
  }

  return {
    result: 'committed',
    accountKey: input.targetKey,
    handle: targetHandle,
  };
}

/** Try to put the user back on the previous active account after
 *  the target failed. Best-effort: if the previous account also
 *  fails to reconnect, we hand off to `fail()` and let the caller
 *  bounce to the login screen. */
async function rollbackAfterTargetFail<H>(
  input: SwitchInputs<H>,
): Promise<SwitchOutcome<H>> {
  if (input.current === null) {
    input.fail();
    return { result: 'rolled-back-no-current' };
  }
  const currentSession = input.loadSession(input.current.key);
  if (currentSession === null) {
    // Previous account's session is gone (concurrent remove? user
    // hit logout in another tab?). Nothing to roll back to.
    input.fail();
    return { result: 'rolled-back-no-current' };
  }
  let restoredHandle: H;
  try {
    restoredHandle = await input.connectAccount(currentSession);
  } catch (err) {
    input.onError(err, 'switch.reconnect-current');
    input.fail();
    return { result: 'rolled-back-no-current' };
  }
  try {
    input.rollbackToCurrent(input.current.key, restoredHandle);
  } catch (err) {
    input.onError(err, 'switch.rollback-commit');
    try {
      await input.disposeHandle(restoredHandle);
    } catch {
      /* swallowed */
    }
    input.fail();
    return { result: 'rolled-back-no-current' };
  }
  return {
    result: 'rolled-back-current',
    accountKey: input.current.key,
    handle: restoredHandle,
  };
}
