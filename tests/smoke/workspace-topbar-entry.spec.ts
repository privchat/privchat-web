// Host-shell entry refactor: Workspace moved out of the left rail into a
// top-bar icon (before invite/wallet) that opens a large modal dialog. The
// legacy login-time buttons (workspace/devices/assistant) are gone.
//
// Forces PLATFORM mode + a seeded active account via addInitScript (same
// pattern as platform-qr-login-ui.spec.ts) so TestApp boots straight into
// ChatWorkspace. Workspace HTTP calls are routed to a fake platform origin.

import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const summary = {id: 'w', name: 'Team', description: '', archived: 0, myRole: 'owner', employeeCount: 0, availableEmployeeCount: 0, employeeAvailabilityKnown: true, openItemCount: 0, lastActivityAt: null};

async function routePlatform(page: Page) {
  await page.route('**/__fake-platform/app/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/config/bootstrap')) data = {gateways: ['wss://gw.example/gate'], features: {}, legal: {}};
    if (path.endsWith('/workspace/page')) data = {list: [summary], total: 1};
    if (path.endsWith('/workspace/list')) data = [{id: 'w', name: 'Team', archived: 0, myRole: 'owner'}];
    if (path.endsWith('/workspace/inbox/list')) data = {entries: []};
    if (path.endsWith('/workspace/project/list')) data = [];
    await route.fulfill({json: {code: 0, data}});
  });
}

test.describe('workspace top-bar entry (platform)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__privchatForcedMode = 'platform';
      w.__privchatForcedPlatformBaseUrl = `${window.location.origin}/__fake-platform/app`;
      window.localStorage.setItem('privchat.web.accounts', JSON.stringify({
        accounts: {
          '0123456789abcdef': {
            url: 'ws://gw-alice/', user_id: '900001', device_id: 'dev-alice', alias: 'Alice',
            added_at: 1_700_000_000_000, mode: 'platform', platform_base_url: 'https://app.example.com/app',
          },
        },
        active: '0123456789abcdef',
      }));
    });
    await routePlatform(page);
    await gotoAppFresh(page);
    await expect(page.getByTestId('topbar-workspace')).toBeVisible();
  });

  test('icon sits before invite/wallet; rail has no workspace tab; legacy entries removed', async ({ page }) => {
    await expect(page.getByTestId('topbar-invite')).toBeVisible();
    await expect(page.getByTestId('topbar-wallet')).toBeVisible();

    // Legacy login-time buttons must be gone.
    await expect(page.getByTestId('workspace-entry')).toHaveCount(0);
    await expect(page.getByTestId('devices-entry')).toHaveCount(0);
    await expect(page.getByTestId('assistant-entry')).toHaveCount(0);

    // Left rail keeps chats/contacts/groups but no workspace tab. Scope to
    // <aside> so the top-bar icon (same accessible name) isn't matched.
    const rail = page.locator('aside');
    await expect(rail.getByRole('button', {name: /^Chats$|^会话$/})).toBeVisible();
    await expect(rail.getByRole('button', {name: /^Workspace$|^工作空间$/})).toHaveCount(0);

    // DOM order: workspace → invite → wallet.
    const ordered = await page.evaluate(() => {
      const get = (id: string) => document.querySelector(`[data-testid="${id}"]`);
      const a = get('topbar-workspace'), b = get('topbar-invite'), c = get('topbar-wallet');
      if (!a || !b || !c) return false;
      const follows = (x: Element, y: Element) => Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
      return follows(a, b) && follows(b, c);
    });
    expect(ordered).toBe(true);
  });

  test('clicking the icon opens a large dialog with the workspace panel; Escape closes and clears the hash', async ({ page }) => {
    await page.getByTestId('topbar-workspace').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('workspace-home')).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe('#/workspace');

    // "Very large": default shadcn dialog is max-w-md (~448px); this one is
    // 95vw capped at 1400px. At the 1280px test viewport that's ~1216px wide,
    // so a >=1000px bound fails for the old default dialog and passes here.
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(1000);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  test('a #/workspace deep link opens the dialog on boot', async ({ page }) => {
    await page.evaluate(() => {location.hash = '/workspace';});
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('workspace-home')).toBeVisible();
  });
});