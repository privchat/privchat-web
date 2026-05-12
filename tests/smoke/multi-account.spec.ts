// R7.5 — multi-account UI hardening smokes.
//
// R7.4's `switch-sequencing.spec.ts` covers the pure sequencer's
// commit / rollback / fail outcomes. This file covers the *real
// React/UI surface* that production users see: registry-driven
// re-renders, the add-account → LoginPage → Cancel transition,
// the in-flight `data-switching` state, and per-account session
// isolation in localStorage.
//
// Five cases:
//
//   1. registry-of-one boot path renders ChatWorkspace + switcher
//      with the active checkmark.
//   2. add-account opens LoginPage with a Cancel button; clicking
//      Cancel restores the workspace and leaves the active
//      account unchanged.
//   3. writing a new entry to the registry (via the production
//      storage primitives) causes the switcher to re-render
//      WITHOUT a page reload — proves the
//      `useSyncExternalStore + subscribeRegistry` chain works.
//   4. while a switch is in flight, the switcher trigger reports
//      `data-switching="1"` and the dropdown can't be opened;
//      after the harness releases the switch, the trigger flips
//      back to `data-switching="0"` and the active account
//      updated.
//   5. switching back and forth between two accounts does NOT
//      mutate either account's namespaced session blob —
//      `privchat.web.session.<A>` and `privchat.web.session.<B>`
//      survive every switch with their original tokens intact.

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
  alias?: string;
  added_at?: number;
}

const ALICE: StagedAccount = {
  accountKey: ALICE_KEY,
  url: 'ws://gw-alice/',
  user_id: '900001',
  device_id: 'dev-alice',
  alias: 'Alice',
  added_at: 1_700_000_000_000,
};
const BOB: StagedAccount = {
  accountKey: BOB_KEY,
  url: 'ws://gw-bob/',
  user_id: '900002',
  device_id: 'dev-bob',
  alias: 'Bob',
  added_at: 1_700_000_001_000,
};

async function stageRegistryAndSessions(
  page: Page,
  accounts: StagedAccount[],
  active: string,
): Promise<void> {
  const accountsMap: Record<string, unknown> = {};
  const sessions: Array<{ key: string; value: string }> = [];
  for (const a of accounts) {
    accountsMap[a.accountKey] = {
      url: a.url,
      user_id: a.user_id,
      device_id: a.device_id,
      alias: a.alias,
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

test.describe('multi-account UI (R7.5)', () => {
  test('1. registry-of-one boot path renders workspace + active checkmark', async ({
    page,
  }) => {
    await stageRegistryAndSessions(page, [ALICE], ALICE.accountKey);
    await gotoAppFresh(page);

    // ChatWorkspace mounted.
    await expect(page.getByTestId('account-switcher-trigger')).toBeVisible();
    // Sidebar tab containers — proves the workspace chrome rendered.
    await expect(page.getByTestId('pane-chats')).toBeVisible();

    // Open the switcher; one entry, marked active.
    await page.getByTestId('account-switcher-trigger').click();
    const entries = page.getByTestId('account-switcher-entry');
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toHaveAttribute(
      'data-account-key',
      ALICE.accountKey,
    );
    await expect(entries.first()).toHaveAttribute(
      'data-account-active',
      '1',
    );
  });

  test('2. add-account opens LoginPage; Cancel restores workspace', async ({
    page,
  }) => {
    await stageRegistryAndSessions(page, [ALICE], ALICE.accountKey);
    await gotoAppFresh(page);

    // Open switcher → click "Add account".
    await page.getByTestId('account-switcher-trigger').click();
    await page.getByTestId('account-switcher-add').click();

    // LoginPage visible — username + password fields are the
    // deterministic markers; the Cancel button only renders when
    // `onCancel` is provided (R7.3 add-account context).
    await expect(page.getByLabel(/Username|用户名/)).toBeVisible();
    await expect(page.getByLabel(/Password|密码/)).toBeVisible();
    const cancel = page.getByRole('button', { name: /Cancel|取消|Hủy/ });
    await expect(cancel).toBeVisible();

    // Click Cancel → workspace restored.
    await cancel.click();
    await expect(page.getByTestId('account-switcher-trigger')).toBeVisible();
    await expect(page.getByTestId('pane-chats')).toBeVisible();

    // Active account unchanged.
    const reg = await page.evaluate((k) => localStorage.getItem(k), REGISTRY_KEY);
    expect(reg).not.toBeNull();
    expect(JSON.parse(reg!).active).toBe(ALICE.accountKey);
  });

  test('3. registry write re-renders switcher without reload', async ({
    page,
  }) => {
    await stageRegistryAndSessions(page, [ALICE], ALICE.accountKey);
    await gotoAppFresh(page);

    // First open: 1 entry.
    await page.getByTestId('account-switcher-trigger').click();
    await expect(
      page.getByTestId('account-switcher-entry'),
    ).toHaveCount(1);

    // Without reloading, write Bob's entry through the production
    // `saveRegistry` primitive. The switcher subscribes via
    // `useSyncExternalStore + subscribeRegistry`, so it MUST
    // re-render against the new snapshot.
    await page.evaluate((bob) => {
      const harness = (window as unknown as {
        __privchatTest: {
          addAccountEntry(args: typeof bob): void;
        };
      }).__privchatTest;
      harness.addAccountEntry({ ...bob, setActive: false });
    }, BOB);

    // Dropdown stays open; entry count grows to 2.
    const entries = page.getByTestId('account-switcher-entry');
    await expect(entries).toHaveCount(2);
    // Sorted by added_at ascending: Alice first, Bob second.
    await expect(entries.nth(0)).toHaveAttribute(
      'data-account-key',
      ALICE.accountKey,
    );
    await expect(entries.nth(1)).toHaveAttribute(
      'data-account-key',
      BOB.accountKey,
    );
  });

  test('4. switcher reports data-switching="1" while pending', async ({
    page,
  }) => {
    await stageRegistryAndSessions(page, [ALICE, BOB], ALICE.accountKey);
    await gotoAppFresh(page);

    // Arm the hold knob BEFORE clicking — TestApp's
    // `onSelectAccount` will park on a Promise until the spec
    // explicitly releases it.
    await page.evaluate(() => {
      window.__privchatTestHoldNextSwitch = true;
    });

    // Open switcher → click Bob.
    await page.getByTestId('account-switcher-trigger').click();
    await page
      .getByTestId('account-switcher-entry')
      .filter({ hasText: 'Bob' })
      .click();

    const trigger = page.getByTestId('account-switcher-trigger');

    // While pending: the trigger is disabled + reports "1".
    await expect(trigger).toHaveAttribute('data-switching', '1');
    await expect(trigger).toBeDisabled();

    // Release. The held switch resolves, TestApp commits Bob,
    // trigger flips back.
    await page.evaluate(() => {
      window.__privchatTestReleaseHeldSwitch?.();
    });
    await expect(trigger).toHaveAttribute('data-switching', '0');
    await expect(trigger).not.toBeDisabled();

    // Trigger label now reflects the new active account (Bob's
    // alias). This is more robust than re-opening the Radix
    // dropdown — the switcher's `triggerLabel` is computed from
    // the same `activeAccountKey` that drives the entries, so
    // testing it covers the same React-state plumbing without
    // racing the popover open/close lifecycle.
    await expect(trigger).toContainText('Bob');
  });

  test('5. session blobs stay namespaced across simulated switches', async ({
    page,
  }) => {
    await stageRegistryAndSessions(page, [ALICE, BOB], ALICE.accountKey);
    await gotoAppFresh(page);

    // Both sessions present at boot.
    const aliceSessionKey = `${SESSION_PREFIX}${ALICE.accountKey}`;
    const bobSessionKey = `${SESSION_PREFIX}${BOB.accountKey}`;
    const initialAlice = await page.evaluate(
      (k) => localStorage.getItem(k),
      aliceSessionKey,
    );
    const initialBob = await page.evaluate(
      (k) => localStorage.getItem(k),
      bobSessionKey,
    );
    expect(initialAlice).not.toBeNull();
    expect(initialBob).not.toBeNull();
    expect(JSON.parse(initialAlice!).access_token).toBe(`tok-${ALICE.accountKey}`);
    expect(JSON.parse(initialBob!).access_token).toBe(`tok-${BOB.accountKey}`);

    // Simulate A → B (sequencer commits).
    await page.evaluate(async (target) => {
      const harness = (window as unknown as {
        __privchatTest: {
          simulateAccountSwitch(args: {
            currentKey: string;
            targetKey: string;
            mode: 'success';
          }): Promise<unknown>;
        };
      }).__privchatTest;
      await harness.simulateAccountSwitch({
        currentKey: '0123456789abcdef',
        targetKey: target,
        mode: 'success',
      });
    }, BOB.accountKey);

    expect(
      JSON.parse(
        (await page.evaluate(
          (k) => localStorage.getItem(k),
          aliceSessionKey,
        ))!,
      ).access_token,
    ).toBe(`tok-${ALICE.accountKey}`);
    expect(
      JSON.parse(
        (await page.evaluate(
          (k) => localStorage.getItem(k),
          bobSessionKey,
        ))!,
      ).access_token,
    ).toBe(`tok-${BOB.accountKey}`);
    expect(
      JSON.parse(
        (await page.evaluate((k) => localStorage.getItem(k), REGISTRY_KEY))!,
      ).active,
    ).toBe(BOB.accountKey);

    // Simulate B → A (back).
    await page.evaluate(async (target) => {
      const harness = (window as unknown as {
        __privchatTest: {
          simulateAccountSwitch(args: {
            currentKey: string;
            targetKey: string;
            mode: 'success';
          }): Promise<unknown>;
        };
      }).__privchatTest;
      await harness.simulateAccountSwitch({
        currentKey: 'fedcba9876543210',
        targetKey: target,
        mode: 'success',
      });
    }, ALICE.accountKey);

    // Both blobs still untouched.
    expect(
      JSON.parse(
        (await page.evaluate(
          (k) => localStorage.getItem(k),
          aliceSessionKey,
        ))!,
      ).access_token,
    ).toBe(`tok-${ALICE.accountKey}`);
    expect(
      JSON.parse(
        (await page.evaluate(
          (k) => localStorage.getItem(k),
          bobSessionKey,
        ))!,
      ).access_token,
    ).toBe(`tok-${BOB.accountKey}`);
    expect(
      JSON.parse(
        (await page.evaluate((k) => localStorage.getItem(k), REGISTRY_KEY))!,
      ).active,
    ).toBe(ALICE.accountKey);
  });
});
