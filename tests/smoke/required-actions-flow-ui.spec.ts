// R8.4c — Required Actions UI gate smokes.
//
// Drives the full state machine: fresh-login prefill, server re-list,
// CompleteProfileAction submit, re-fetch authority, UnsupportedRequiredAction
// fail-closed, localStorage pending flag self-heal, multi-account isolation,
// BUILTIN noop pass-through.
//
// Forced PLATFORM via window flags + same-origin fake baseUrl (R8.3b
// pattern). HTTP intercepted with `page.route()`.

import { expect, test, type Page, type Route } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

function fakeBaseUrl(originUrl: string): string {
  return `${originUrl}/__fake-platform/app`;
}

async function originOf(page: Page): Promise<string> {
  return page.evaluate(() => window.location.origin);
}

interface MockEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

async function fulfillJson<T>(
  route: Route,
  status: number,
  envelope: MockEnvelope<T>,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(envelope),
  });
}

const COMPLETE_PROFILE_ACTION = {
  action: 'complete_profile',
  required: true,
  title: '设置昵称',
  titleKey: 'requiredAction.completeProfile.nickname',
  fields: ['nickname'],
};

/** Pre-seed Alice (PLATFORM) in localStorage so the test app starts
 *  with an active session, then drives onAdd-account → SMS login.
 *  TestApp gate evaluates against Alice's account key when no
 *  fresh-login lands. */
async function setupPlatform(page: Page): Promise<{ baseUrl: string }> {
  const origin = await originOf(page);
  const baseUrl = fakeBaseUrl(origin);
  await page.addInitScript(
    ({ baseUrlInit }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__privchatForcedMode = 'platform';
      w.__privchatForcedPlatformBaseUrl = baseUrlInit;
      window.localStorage.setItem(
        'privchat.web.accounts',
        JSON.stringify({
          accounts: {
            '0123456789abcdef': {
              url: 'ws://gw-alice/',
              user_id: '900001',
              device_id: 'dev-alice',
              alias: 'Alice',
              added_at: 1_700_000_000_000,
              mode: 'platform',
              platform_base_url: baseUrlInit,
            },
          },
          active: '0123456789abcdef',
        }),
      );
      window.localStorage.setItem(
        'privchat.web.session.0123456789abcdef',
        JSON.stringify({
          url: 'ws://gw-alice/',
          user_id: '900001',
          access_token: 'access-alice',
          device_id: 'dev-alice',
          saved_at: 1_700_000_000_000,
          account_mode: 'platform',
          platform_base_url: baseUrlInit,
          refresh_token: 'refresh-alice',
        }),
      );
    },
    { baseUrlInit: baseUrl },
  );
  await gotoAppFresh(page);
  return { baseUrl };
}

/** Most tests need the gate to evaluate immediately. Default Alice has
 *  no pending actions — the gate returns [] from list() → renders the
 *  workspace. Tests that want to surface a pending gate override the
 *  /required-actions route BEFORE the gate boots. */
async function routeRequiredActions(
  page: Page,
  envelope: MockEnvelope<{ requiredActions?: Array<Record<string, unknown>> }>,
): Promise<void> {
  await page.route(
    '**/__fake-platform/app/account/required-actions',
    async (route: Route) => {
      await fulfillJson(route, 200, envelope);
    },
  );
}

test.describe('Required Actions UI gate (R8.4c)', () => {
  test('1. server returns empty → ChatWorkspace renders (no gate)', async ({
    page,
  }) => {
    await routeRequiredActions(page, { code: 0, data: { requiredActions: [] } });
    await setupPlatform(page);

    // ChatWorkspace surfaces the "no conversation selected" or "联系人/会话" tab strip.
    await expect(
      page.getByTestId('account-switcher-trigger'),
    ).toBeVisible();
    // Onboarding pieces should be absent
    await expect(page.getByTestId('onboarding-nickname-input')).toHaveCount(0);
    await expect(page.getByTestId('unsupported-required-action')).toHaveCount(0);
  });

  test('2. server returns complete_profile → CompleteProfileAction renders', async ({
    page,
  }) => {
    await routeRequiredActions(page, {
      code: 0,
      data: { requiredActions: [COMPLETE_PROFILE_ACTION] },
    });
    await setupPlatform(page);

    await expect(page.getByTestId('onboarding-nickname-input')).toBeVisible();
    await expect(page.getByTestId('onboarding-nickname-submit')).toBeVisible();
    // Workspace must NOT be visible
    await expect(
      page.getByTestId('account-switcher-trigger'),
    ).toHaveCount(0);
  });

  test('3. ChatWorkspace strictly blocked while pending — no leak through', async ({
    page,
  }) => {
    await routeRequiredActions(page, {
      code: 0,
      data: { requiredActions: [COMPLETE_PROFILE_ACTION] },
    });
    await setupPlatform(page);

    await expect(page.getByTestId('onboarding-nickname-input')).toBeVisible();
    // Sidebar tabs (Contacts / Groups) and account switcher trigger
    // belong to ChatWorkspace and must not render under gate.
    await expect(page.getByTestId('account-switcher-trigger')).toHaveCount(0);
  });

  test('4. submit valid nickname → server clears → enter workspace', async ({
    page,
  }) => {
    // Mutable closure response: server "stores" the new nickname when
    // update-nickname fires; subsequent list() calls reflect the new
    // state. This makes the mock robust against StrictMode's double
    // effect firing on the initial gate boot (both fires see pending
    // until the user actually submits).
    let listEnvelope: MockEnvelope<{
      requiredActions?: Array<Record<string, unknown>>;
    }> = { code: 0, data: { requiredActions: [COMPLETE_PROFILE_ACTION] } };
    let listCallCount = 0;
    await page.route(
      '**/__fake-platform/app/account/required-actions',
      async (route: Route) => {
        listCallCount += 1;
        await fulfillJson(route, 200, listEnvelope);
      },
    );
    let updateBody: unknown = null;
    await page.route(
      '**/__fake-platform/app/member/user/update-nickname',
      async (route: Route) => {
        updateBody = JSON.parse(route.request().postData() ?? 'null');
        // Server "accepts" — flip subsequent list() responses to empty.
        listEnvelope = { code: 0, data: { requiredActions: [] } };
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    await setupPlatform(page);
    await expect(page.getByTestId('onboarding-nickname-input')).toBeVisible();

    await page.getByTestId('onboarding-nickname-input').fill('Alice');
    await page.getByTestId('onboarding-nickname-submit').click();

    // After update + re-list → workspace renders
    await expect(
      page.getByTestId('account-switcher-trigger'),
    ).toBeVisible({ timeout: 5_000 });

    expect(updateBody).toEqual({ nickname: 'Alice' });
    // Gate calls list() on mount (StrictMode may double-fire) plus
    // once after action completion. Loose lower bound.
    expect(listCallCount).toBeGreaterThanOrEqual(2);
  });

  test('5. submit invalid (too short) → inline error, NO HTTP, stays on page', async ({
    page,
  }) => {
    await routeRequiredActions(page, {
      code: 0,
      data: { requiredActions: [COMPLETE_PROFILE_ACTION] },
    });
    let updateHits = 0;
    await page.route(
      '**/__fake-platform/app/member/user/update-nickname',
      async (route: Route) => {
        updateHits += 1;
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    await setupPlatform(page);
    await expect(page.getByTestId('onboarding-nickname-input')).toBeVisible();

    // 1-char (trim → 1, server min is 2)
    await page.getByTestId('onboarding-nickname-input').fill('A');
    await page.getByTestId('onboarding-nickname-submit').click();

    await expect(page.getByTestId('onboarding-error')).toBeVisible();
    await page.waitForTimeout(200);
    expect(updateHits).toBe(0);
    // Still on action page
    await expect(page.getByTestId('onboarding-nickname-input')).toBeVisible();
  });

  test('6. submit empty/whitespace → inline error, NO HTTP', async ({
    page,
  }) => {
    await routeRequiredActions(page, {
      code: 0,
      data: { requiredActions: [COMPLETE_PROFILE_ACTION] },
    });
    let updateHits = 0;
    await page.route(
      '**/__fake-platform/app/member/user/update-nickname',
      async (route: Route) => {
        updateHits += 1;
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    await setupPlatform(page);

    await page.getByTestId('onboarding-nickname-input').fill('   ');
    await page.getByTestId('onboarding-nickname-submit').click();

    await expect(page.getByTestId('onboarding-error')).toBeVisible();
    await page.waitForTimeout(200);
    expect(updateHits).toBe(0);
  });

  test('7. server-side validation error → display server message, stay on page', async ({
    page,
  }) => {
    await routeRequiredActions(page, {
      code: 0,
      data: { requiredActions: [COMPLETE_PROFILE_ACTION] },
    });
    await page.route(
      '**/__fake-platform/app/member/user/update-nickname',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          code: 4001,
          message: 'INVALID_NICKNAME_LENGTH',
        });
      },
    );

    await setupPlatform(page);

    await page.getByTestId('onboarding-nickname-input').fill('Alice');
    await page.getByTestId('onboarding-nickname-submit').click();

    await expect(page.getByTestId('onboarding-error')).toContainText(
      'INVALID_NICKNAME_LENGTH',
    );
    // Still on action page
    await expect(page.getByTestId('onboarding-nickname-input')).toBeVisible();
  });

  test('8. unknown required=true action → UnsupportedPage (fail-closed)', async ({
    page,
  }) => {
    await routeRequiredActions(page, {
      code: 0,
      data: {
        requiredActions: [
          {
            action: 'complete_kyc',
            required: true,
            title: 'KYC 认证',
            titleKey: 'requiredAction.completeKyc',
          },
        ],
      },
    });

    await setupPlatform(page);

    await expect(page.getByTestId('unsupported-required-action')).toBeVisible();
    await expect(page.getByTestId('unsupported-reload')).toBeVisible();
    await expect(page.getByTestId('unsupported-logout')).toBeVisible();
    // CompleteProfileAction must NOT be rendered
    await expect(page.getByTestId('onboarding-nickname-input')).toHaveCount(0);
    // Workspace must NOT be rendered
    await expect(
      page.getByTestId('account-switcher-trigger'),
    ).toHaveCount(0);
  });

  test('9. unknown action with required field MISSING → still fail-closed (default true)', async ({
    page,
  }) => {
    await routeRequiredActions(page, {
      code: 0,
      data: {
        requiredActions: [
          // No `required` field — wire-defense says missing → true.
          {
            action: 'foobar_action',
            title: 'Some unknown thing',
          },
        ],
      },
    });

    await setupPlatform(page);

    await expect(page.getByTestId('unsupported-required-action')).toBeVisible();
  });

  test('10. unknown action with required=false → silent skip, enter workspace', async ({
    page,
  }) => {
    await routeRequiredActions(page, {
      code: 0,
      data: {
        requiredActions: [
          {
            action: 'optional_advice',
            required: false,
            title: 'Optional thing',
          },
        ],
      },
    });

    await setupPlatform(page);

    // Skipped → no action page, no unsupported page, workspace renders
    await expect(
      page.getByTestId('account-switcher-trigger'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('unsupported-required-action')).toHaveCount(0);
    await expect(page.getByTestId('onboarding-nickname-input')).toHaveCount(0);
  });

  test('11. localStorage pending flag set when gate evaluates pending', async ({
    page,
  }) => {
    await routeRequiredActions(page, {
      code: 0,
      data: { requiredActions: [COMPLETE_PROFILE_ACTION] },
    });
    await setupPlatform(page);

    await expect(page.getByTestId('onboarding-nickname-input')).toBeVisible();

    // Flag should be set for Alice's account key
    const flag = await page.evaluate(() =>
      window.localStorage.getItem(
        'privchat.web.required-actions-pending.0123456789abcdef',
      ),
    );
    expect(flag).toBe('true');
  });

  test('12. localStorage pending flag self-heals when server returns empty', async ({
    page,
  }) => {
    // Pre-stage a stale flag (as if user closed tab while pending)
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'privchat.web.required-actions-pending.0123456789abcdef',
        'true',
      );
    });
    await routeRequiredActions(page, {
      code: 0,
      data: { requiredActions: [] },
    });
    await setupPlatform(page);

    // Workspace renders (server says clear)
    await expect(
      page.getByTestId('account-switcher-trigger'),
    ).toBeVisible({ timeout: 5_000 });
    // Stale flag must be cleared
    const flag = await page.evaluate(() =>
      window.localStorage.getItem(
        'privchat.web.required-actions-pending.0123456789abcdef',
      ),
    );
    expect(flag).toBeNull();
  });

  test('13. server 5xx on list() → fail-open enter workspace (gate is not a security boundary)', async ({
    page,
  }) => {
    await page.route(
      '**/__fake-platform/app/account/required-actions',
      async (route: Route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"code":500,"message":"transient","data":null}',
        });
      },
    );
    await setupPlatform(page);

    // Workspace renders despite 503 (captureException logged off-band).
    await expect(
      page.getByTestId('account-switcher-trigger'),
    ).toBeVisible({ timeout: 5_000 });
    // No onboarding / unsupported UI
    await expect(page.getByTestId('onboarding-nickname-input')).toHaveCount(0);
    await expect(page.getByTestId('unsupported-required-action')).toHaveCount(0);
  });
});
