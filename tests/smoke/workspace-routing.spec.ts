import { test, expect, type Page } from '@playwright/test';

const summary = {id: 'w', name: 'Team', description: '', archived: 0, myRole: 'owner', employeeCount: 0, availableEmployeeCount: 0, employeeAvailabilityKnown: true, openItemCount: 0, lastActivityAt: null};
const space = {id: 'w', name: 'Team', description: '', archived: 0, myRole: 'owner'};
const feedPage = {items: [], olderCursor: null, hasOlder: false, refreshRequired: false};

async function routes(page: Page) {
  const views: (string | null)[] = [];
  await page.route('**/__route/app/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown = [];
    if (path.endsWith('/workspace/page')) data = {list: [summary], total: 1};
    if (path.endsWith('/workspace/list')) data = [{id: 'w', name: 'Team', archived: 0, myRole: 'owner'}];
    if (path.includes('/workspace/get/')) data = space;
    if (path.endsWith('/workspace/project/list')) data = [];
    if (path.endsWith('/workspace/inbox/list')) data = {entries: []};
    if (path.endsWith('/workspace/employee/page')) data = {items: [], nextCursor: null, hasMore: false};
    if (path.endsWith('/room/join')) data = {channelId: '400', channelType: 3, ticket: 'fixture', expiresAt: Date.now() + 60000, eventProtocolVersion: 1};
    if (path.endsWith('/activity/page')) {views.push(url.searchParams.get('view')); data = feedPage;}
    await route.fulfill({json: {code: 0, data}});
  });
  return views;
}

async function mount(page: Page, hash: string, accountKey?: string) {
  await page.evaluate(async ({hash, accountKey}) => {
    const {mountWorkspacePage} = await import('/src/test-harness/workspace-console.tsx');
    (window as any).unmountRoute = mountWorkspacePage(`${location.origin}/__route/app`, hash, undefined, accountKey);
  }, {hash, accountKey});
}
async function unmount(page: Page) {
  await page.evaluate(() => {(window as any).unmountRoute?.(); (window as any).unmountRoute = undefined;});
}

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.evaluate(async () => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage('en');});
});

test('records deep link loads the unified history view directly and survives a refresh remount', async ({page}) => {
  const views = await routes(page);
  await mount(page, '#/workspace/space/w/records');
  const detail = page.getByTestId('workspace-detail');
  await expect(detail).toBeVisible();
  await expect.poll(() => views.includes('history_tasks_v1')).toBe(true);
  expect(views).not.toContain('active_tasks_v1');
  await unmount(page);
  await mount(page, '#/workspace/space/w/records');
  await expect(page.getByTestId('workspace-detail')).toBeVisible();
  expect(views).not.toContain('active_tasks_v1');
});

test('back and forward move between home and the space without losing the route', async ({page}) => {
  await routes(page);
  await mount(page, '#/workspace');
  await expect(page.getByTestId('workspace-home')).toBeVisible();
  await page.getByTestId('workspace-card').click();
  await expect(page.getByTestId('workspace-detail')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#/workspace/space/w');
  await page.goBack();
  await expect(page.getByTestId('workspace-home')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#/workspace');
  await page.goForward();
  await expect(page.getByTestId('workspace-detail')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#/workspace/space/w');
});

test('switching accounts drops scoped routes but a fresh deep link still works', async ({page}) => {
  await routes(page);
  await mount(page, '#/workspace/space/w', 'account-a');
  await expect(page.getByTestId('workspace-detail')).toBeVisible();
  await unmount(page);
  await mount(page, '#/workspace/space/w', 'account-b');
  await expect(page.getByTestId('workspace-home')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#/workspace');
  await unmount(page);
  await mount(page, '#/workspace/space/w', 'account-b');
  await expect(page.getByTestId('workspace-detail')).toBeVisible();
});

test('hash parsing is scoped, encoded and falls back home for unknown workspace paths', async ({page}) => {
  await routes(page);
  const result = await page.evaluate(async () => {
    const {parseWorkspaceRoute, isWorkspaceHash, workspaceHref} = await import('/src/features/workspace/routes.ts');
    return {
      foreign: parseWorkspaceRoute('#/chat/123'),
      unknown: parseWorkspaceRoute('#/workspace/nope/deep'),
      hashes: ['#/workspace', '#/workspace/', '#/workspace?x=1', '#/chat', '#/workspacex'].map(h => isWorkspaceHash(h)),
      item: parseWorkspaceRoute('#/workspace/space/w/item/42?execution=e1'),
      href: workspaceHref({view: 'item', spaceId: 'w /', itemId: '42', executionId: 'e &'}),
      roundTrip: parseWorkspaceRoute(workspaceHref({view: 'records', spaceId: 'w /'})),
    };
  });
  expect(result.foreign).toBeNull();
  expect(result.unknown).toEqual({view: 'home'});
  expect(result.hashes).toEqual([true, true, true, false, false]);
  expect(result.item).toEqual({view: 'item', spaceId: 'w', itemId: '42', executionId: 'e1'});
  expect(result.href).toBe('#/workspace/space/w%20%2F/item/42?execution=e+%26');
  expect(result.roundTrip).toEqual({view: 'records', spaceId: 'w /'});
  await mount(page, '#/workspace/nope/deep');
  await expect(page.getByTestId('workspace-home')).toBeVisible();
});