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
    if (path.includes('/workspace/get/')) data = summary;
    if (path.endsWith('/activity/page')) data = {items: [], olderCursor: null, hasOlder: false};
    if (path.endsWith('/workspace/project/list')) data = [];
    await route.fulfill({json: {code: 0, data}});
  });
}

test.describe('workspace app navigation (platform)', () => {
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
    await expect(page.getByTestId('nav-workspace')).toBeVisible();
  });

  test('the global rail owns navigation and account actions', async ({ page }) => {
    const rail = page.getByTestId('app-nav');
    await expect(rail.getByRole('button')).toHaveCount(4);
    expect(await rail.getByRole('button').evaluateAll(buttons => buttons.map(b => b.getAttribute('data-testid'))))
      .toEqual(['nav-chats', 'nav-contacts', 'nav-groups', 'nav-workspace']);

    await page.getByTestId('self-profile-trigger').click();
    await expect(page.getByTestId('account-wallet')).toBeVisible();
    await expect(page.getByTestId('account-invite')).toBeVisible();
    await expect(page.getByTestId('account-switcher-trigger')).toBeVisible();
    await page.getByTestId('account-my-qr').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('workspace is a page; navigating back restores the chat draft', async ({ page }) => {
    const chat = page.getByTestId('pane-chats').getByText('Alice').first();
    await chat.click();
    const composer = page.getByPlaceholder(/Type a message|输入消息/);
    await composer.fill('Draft before leaving');

    await page.getByTestId('nav-workspace').click();
    const main = page.getByTestId('workspace-main');
    await expect(main.getByTestId('workspace-home')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('pane-chats')).toBeHidden();
    await expect(page.getByTestId('nav-workspace')).toHaveAttribute('aria-current', 'page');
    expect((await main.boundingBox())!.width).toBeGreaterThan(1000);
    await page.keyboard.press('Escape');
    await expect(main).toBeVisible();

    await page.goBack();
    await expect(main).toHaveCount(0);
    await expect(composer).toHaveValue('Draft before leaving');
    await page.goForward();
    await expect(main).toBeVisible();
  });

  test('a scoped deep link survives refresh in a narrow viewport', async ({ page }) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/#/workspace/space/w');
    await expect(page.getByTestId('workspace-main').getByTestId('workspace-detail')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('workspace-detail')).toBeVisible();
    const main = (await page.getByTestId('workspace-main').boundingBox())!;
    const rail = (await page.getByTestId('app-nav').boundingBox())!;
    expect(main.width).toBe(390);
    expect(rail.y).toBeGreaterThanOrEqual(main.y + main.height);
    await page.getByTestId('nav-contacts').click();
    await expect(page).toHaveURL(/#\/contacts$/);
    await expect(page.getByTestId('pane-contacts')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('workspace-detail')).toBeVisible();
  });
});
