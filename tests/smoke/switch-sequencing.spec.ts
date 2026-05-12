// R7.4 — switch sequencer behaviour smokes.
//
// The sequencer is `switchAccountSafely(...)` in
// `src/lib/switch-account.ts`. Production wires it up in App.tsx
// with real connectAccount / dispose / runtime cleanup; this spec
// drives it through the harness's `simulateAccountSwitch(...)`
// control with mocked transport callbacks so we can assert on
// each terminal outcome without a backend.
//
// Three branches covered:
//
//   1. successful switch → registry.active is `target`, seam is
//      `target`, sequencer trace shows runtimeCleanup BEFORE
//      disconnect BEFORE connect BEFORE commit
//
//   2. failed target connect, current reconnect succeeds →
//      registry.active stays `current`, seam stays `current`,
//      trace shows the rollback path
//
//   3. failed target AND failed current reconnect → registry's
//      `active` reverts to whatever it was when entering (since
//      we never committed), `fail` was called, the user is
//      effectively logged out from the sequencer's POV
//
// The harness's `simulateAccountSwitch` mirrors what App.tsx's
// `commit` callback would do (write registry.active + flip the
// seam) so the post-switch assertions match the production state.

import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const REGISTRY_KEY = 'privchat.web.accounts';
const SESSION_PREFIX = 'privchat.web.session.';

const ALICE_KEY = '0123456789abcdef';
const BOB_KEY = 'fedcba9876543210';

interface StagedAccount {
  accountKey: string;
  url: string;
  user_id: string;
  device_id: string;
  added_at?: number;
}

const ALICE: StagedAccount = {
  accountKey: ALICE_KEY,
  url: 'ws://gw-alice/',
  user_id: '900001',
  device_id: 'dev-alice',
  added_at: 1_700_000_000_000,
};
const BOB: StagedAccount = {
  accountKey: BOB_KEY,
  url: 'ws://gw-bob/',
  user_id: '900002',
  device_id: 'dev-bob',
  added_at: 1_700_000_001_000,
};

async function stageRegistryAndSessions(
  page: Page,
  accounts: StagedAccount[],
  active: string | null,
): Promise<void> {
  const accountsMap: Record<string, unknown> = {};
  const sessions: Array<{ key: string; value: string }> = [];
  for (const a of accounts) {
    accountsMap[a.accountKey] = {
      url: a.url,
      user_id: a.user_id,
      device_id: a.device_id,
      added_at: a.added_at ?? 1_700_000_000_000,
    };
    sessions.push({
      key: `${SESSION_PREFIX}${a.accountKey}`,
      value: JSON.stringify({
        url: a.url,
        user_id: a.user_id,
        access_token: `tok-${a.accountKey}`,
        device_id: a.device_id,
        saved_at: 1_700_000_000_000,
      }),
    });
  }
  const regJson = JSON.stringify({ accounts: accountsMap, active });
  await page.addInitScript(
    ({ regKey, regValue, sess }) => {
      localStorage.setItem(regKey, regValue);
      for (const s of sess) {
        localStorage.setItem(s.key, s.value);
      }
    },
    { regKey: REGISTRY_KEY, regValue: regJson, sess: sessions },
  );
}

interface SimulatedOutcome {
  result: string;
  reason?: string;
  registryActive: string | null;
  seamActive: string;
  trace: string[];
}

async function simulateSwitch(
  page: Page,
  args: {
    currentKey: string | null;
    targetKey: string;
    mode: 'success' | 'fail-target-only' | 'fail-target-and-current';
  },
): Promise<SimulatedOutcome> {
  return page.evaluate(async (a) => {
    const harness = (
      window as unknown as {
        __privchatTest: {
          simulateAccountSwitch(args: typeof a): Promise<unknown>;
        };
      }
    ).__privchatTest;
    return (await harness.simulateAccountSwitch(a)) as unknown as {
      result: string;
      reason?: string;
      registryActive: string | null;
      seamActive: string;
      trace: string[];
    };
  }, args);
}

test.describe('switch sequencing (R7.4)', () => {
  test.beforeEach(async ({ page }) => {
    await stageRegistryAndSessions(page, [ALICE, BOB], ALICE_KEY);
    await gotoAppFresh(page);
  });

  test('successful switch commits target, runs cleanup before disconnect', async ({
    page,
  }) => {
    const out = await simulateSwitch(page, {
      currentKey: ALICE_KEY,
      targetKey: BOB_KEY,
      mode: 'success',
    });

    expect(out.result).toBe('committed');
    expect(out.registryActive).toBe(BOB_KEY);
    expect(out.seamActive).toBe(BOB_KEY);

    // Ordering invariants the sequencer guarantees:
    //   runtimeCleanup → disconnect old → dispose old → connect target → commit
    const idxRuntime = out.trace.indexOf('runtimeCleanup');
    const idxDisconnect = out.trace.findIndex((s) =>
      s.startsWith('disconnect:'),
    );
    const idxDispose = out.trace.findIndex((s) => s.startsWith('dispose:'));
    const idxConnect = out.trace.findIndex((s) => s.startsWith('connect:'));
    const idxCommit = out.trace.findIndex((s) => s.startsWith('commit:'));
    expect(idxRuntime).toBeGreaterThanOrEqual(0);
    expect(idxDisconnect).toBeGreaterThan(idxRuntime);
    expect(idxDispose).toBeGreaterThan(idxDisconnect);
    expect(idxConnect).toBeGreaterThan(idxDispose);
    expect(idxCommit).toBeGreaterThan(idxConnect);
    expect(out.trace).toContain(`commit:${BOB_KEY}`);
  });

  test('failed target connect rolls back to current, registry.active unchanged', async ({
    page,
  }) => {
    const out = await simulateSwitch(page, {
      currentKey: ALICE_KEY,
      targetKey: BOB_KEY,
      mode: 'fail-target-only',
    });

    expect(out.result).toBe('rolled-back-current');
    // The critical R7.4 invariant: a failed switch must NOT have
    // flipped registry.active away from Alice.
    expect(out.registryActive).toBe(ALICE_KEY);
    expect(out.seamActive).toBe(ALICE_KEY);

    expect(out.trace).toContain(`rollback:${ALICE_KEY}`);
    // Should NOT have called the success commit.
    expect(out.trace.some((s) => s === `commit:${BOB_KEY}`)).toBe(false);
    // Sequencer logged the target connect failure.
    expect(
      out.trace.some((s) => s.startsWith('error:switch.connect-target:')),
    ).toBe(true);
  });

  test('failed target + failed current recovery → fail, no false active', async ({
    page,
  }) => {
    const out = await simulateSwitch(page, {
      currentKey: ALICE_KEY,
      targetKey: BOB_KEY,
      mode: 'fail-target-and-current',
    });

    expect(out.result).toBe('rolled-back-no-current');
    // Sequencer never committed target → registry.active should
    // still point at Alice (the pre-switch active).
    expect(out.registryActive).toBe(ALICE_KEY);

    expect(out.trace).toContain('fail');
    expect(out.trace.some((s) => s === `commit:${BOB_KEY}`)).toBe(false);
    expect(
      out.trace.some((s) => s === `rollback:${ALICE_KEY}`),
    ).toBe(false);
    expect(
      out.trace.some((s) =>
        s.startsWith('error:switch.connect-target:'),
      ),
    ).toBe(true);
    expect(
      out.trace.some((s) =>
        s.startsWith('error:switch.reconnect-current:'),
      ),
    ).toBe(true);
  });

  test('rejects when target session is missing', async ({ page }) => {
    // Stage a registry where Bob is registered but his session
    // blob is not present (simulates concurrent removal between
    // registry read and session read).
    await page.evaluate((sessionKey) => {
      localStorage.removeItem(sessionKey);
    }, `${SESSION_PREFIX}${BOB_KEY}`);

    const out = await simulateSwitch(page, {
      currentKey: ALICE_KEY,
      targetKey: BOB_KEY,
      mode: 'success',
    });

    expect(out.result).toBe('rejected');
    expect(out.reason).toBe('no-target-session');
    // Hard-reject path: registry.active untouched.
    expect(out.registryActive).toBe(ALICE_KEY);
    // No connect/disconnect/commit/rollback should have happened.
    expect(out.trace.some((s) => s.startsWith('connect:'))).toBe(false);
    expect(out.trace.some((s) => s.startsWith('commit:'))).toBe(false);
  });
});
