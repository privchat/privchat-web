import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const summary = {id: 'w', name: 'Team', description: '', archived: 0, myRole: 'owner', employeeCount: 0, availableEmployeeCount: 0, employeeAvailabilityKnown: true, openItemCount: 0, lastActivityAt: null};

async function routePlatform(page: Page, spaces = [summary]) {
  await page.route('**/__fake-platform/app/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/config/bootstrap')) data = {gateways: ['wss://gw.example/gate'], features: {}, legal: {}};
    if (path.endsWith('/workspace/page')) data = {list: spaces, total: spaces.length};
    if (path.endsWith('/workspace/list')) data = spaces;
    if (path.endsWith('/workspace/inbox/list')) data = {entries: []};
    if (path.endsWith('/room/join')) data = {channelId: '400', channelType: 3, ticket: 'fixture', expiresAt: Date.now() + 60000, eventProtocolVersion: 1};
    if (path.includes('/workspace/get/')) data = spaces.find(space => path.endsWith(`/${space.id}`)) ?? summary;
    if (path.endsWith('/workspace/employee/page')) data = {items: [], hasMore: false, nextCursor: null};
    if (path.endsWith('/agent/nodes')) data = [];
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
      window.localStorage.setItem('privchat.web.session.0123456789abcdef', JSON.stringify({
        url: 'ws://gw-alice/', user_id: '900001', device_id: 'dev-alice', access_token: 'test', saved_at: Date.now(),
        account_mode: 'platform', platform_base_url: w.__privchatForcedPlatformBaseUrl,
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
    await expect(main.getByTestId('workspace-detail')).toBeVisible();
    await expect(page).toHaveURL(/#\/workspace\/space\/w$/);
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

  test('the rail resumes the last authorized workspace, not the first row', async ({page}) => {
    await routePlatform(page, [summary, {...summary, id: 'w2', name: 'Other team'}]);
    await page.getByTestId('nav-workspace').click();
    await expect(page).toHaveURL(/\/space\/w$/);
    await page.locator('select').filter({has: page.locator('option[value="w2"]')}).selectOption('w2');
    await expect(page).toHaveURL(/\/space\/w2$/);
    await expect(page.getByTestId('workspace-detail').getByRole('button', {name: /New task|新建任务/})).toBeEnabled();
    await page.getByTestId('nav-chats').click();
    await page.getByTestId('nav-workspace').click();
    await expect(page).toHaveURL(/\/space\/w2$/);
  });

  test('setting up a workstation preserves the unsubmitted draft', async ({page}) => {
    await page.getByTestId('nav-workspace').click();
    await page.getByTestId('workspace-detail').getByRole('button', {name: /New task|新建任务/}).click();
    const form = page.getByTestId('create-work-item');
    await form.getByRole('textbox').first().fill('Keep this task');
    await form.getByRole('textbox').nth(1).fill('Keep the description too');
    await form.getByRole('button', {name: /Connect a workstation|连接工作站/}).click();
    await expect(page).toHaveURL(/\/devices\?fromTask=w$/);
    await page.getByRole('button', {name: /Back to task draft|返回任务草稿/}).click();
    await expect(form.getByRole('textbox').first()).toHaveValue('Keep this task');
    await expect(form.getByRole('textbox').nth(1)).toHaveValue('Keep the description too');
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
