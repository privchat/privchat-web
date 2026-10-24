import { test, expect, type Page } from '@playwright/test';
const space = (id = 'w', extras = {}) => ({id, name: `Space ${id}`, description: 'One line', archived: 0, myRole: 'owner', employeeCount: 3, availableEmployeeCount: 1, employeeAvailabilityKnown: true, openItemCount: 2, lastActivityAt: null, ...extras});
const node = {nodeId: 'n', name: 'Mac', state: 'active', granted: ['agent.codex'], capabilities: [{name: 'agent.codex', available: true}], workdirs: [{id: 'dir', label: 'Repository'}]};
const employee = {id: 'ref', workspaceId: 'w', employeeId: 'emp', name: 'Engineer', nodeId: 'n', capability: 'agent.codex', workdirBindingId: 'dir', available: true, projectTargetIds: ['target']};
const project = {id: 'p', ownerUserId: 'owner', writable: true, manageable: true, name: 'Project', archived: 0, version: 7, targets: [{id: 'target', nodeId: 'n', workdirBindingId: 'dir'}]};
const item = (id: string, status = 'open', version = 1) => ({id, workspaceId: 'w', title: `Task ${id}`, description: '', status, version, createdAt: Number(id), closedAt: ['done', 'cancelled'].includes(status) ? Number(id) : null});
const row = (id: string, status = 'open', version = 1) => ({item: item(id, status, version), latestExecution: {id: `link-${id}`, executionId: `exec-${id}`, employeeId: 'emp', state: 'succeeded'}, executionCount: 2});
const feed = (items = [row('21'), row('22')], more = true) => ({items, olderCursor: more ? 'opaque-w' : null, hasOlder: more, refreshRequired: false});
async function mount(page: Page) {
  await page.goto('/'); await page.evaluate(async () => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage('en'); const {mountWorkspacePage} = await import('/src/test-harness/workspace-console.tsx'); mountWorkspacePage(`${location.origin}/__v16/app`);});
}
async function mock(page: Page, override?: (path: string, query: URL, body: any) => unknown) {
  const requests: {path: string; query: URL; method: string; body: any}[] = [];
  await page.route('**/__v16/app/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/__v16/app', ''); const method = route.request().method(); const body = method === 'POST' || method === 'PUT' ? route.request().postDataJSON() : undefined;
    requests.push({path, query: url, method, body}); let data: unknown = [];
    if (path === '/workspace/page') data = {list: [space(), space('other', {employeeCount: 1, availableEmployeeCount: null, employeeAvailabilityKnown: false})], total: 2};
    if (path === '/workspace/list') data = [space()]; if (path === '/workspace/project/page') data = {list: [project], total: 1}; if (path === '/workspace/project/list') data = [project]; if (path === '/workspace/project/get/p') data = project;
    if (path === '/agent/nodes') data = [node]; if (path === '/workspace/agent-binding/list') data = [{id: 'b', nodeId: 'n', capability: 'agent.codex', revoked: 0}];
    if (path === '/workspace/employee/candidates' || path === '/workspace/employee/list') data = [employee]; if (path === '/workspace/work-item/create') data = item('42');
    if (path === '/workspace/employee/page') data = {items: [employee], nextCursor: null, hasMore: false};
    if (path === '/workspace/room/join') data = {channelId: '400', channelType: 3, ticket: 'fixture-room', expiresAt: Date.now() + 60000, eventProtocolVersion: 1};
    if (path === '/workspace/activity/page') data = url.searchParams.has('cursor') ? feed([row('1', 'done'), row('2', 'cancelled'), row('21')], false) : feed();
    const custom = override?.(path, url, body); if (custom === 'abort') {await route.abort(); return;} await route.fulfill({json: {code: 0, data: custom === undefined ? data : custom}});
  }); return requests;
}
test('cards separate association count and availability; exact management menu; no execution or room requests', async ({page}) => {
  const requests = await mock(page); await mount(page); const cards = page.getByTestId('workspace-card'); await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Employees: 3'); await expect(cards.first()).toContainText('Available: 1'); await expect(cards.last()).toContainText('Available: Temporarily unavailable'); await expect(cards.first()).not.toContainText('Last activity');
  await page.getByRole('button', {name: 'Manage', exact: true}).click(); await expect(page.getByRole('menuitem')).toHaveText(['Project management', 'Device management', 'Create workspace']); expect(requests.every(r => r.method === 'GET' && !r.path.includes('room') && !r.path.includes('execution'))).toBe(true);
});
test('empty list keeps management; creating a space only saves the space', async ({page}) => {
  const requests = await mock(page, path => path === '/workspace/page' ? {list: [], total: 0} : undefined); await mount(page);
  await page.getByRole('button', {name: 'Manage', exact: true}).click(); await page.getByRole('menuitem', {name: 'Create workspace', exact: true}).click(); await page.getByLabel('Name', {exact: true}).fill('New team'); await page.getByRole('button', {name: 'Save', exact: true}).click(); await expect(page.getByTestId('workspace-home')).toBeVisible(); expect(requests.filter(r => r.method === 'POST').map(r => r.path)).toEqual(['/workspace/create']);
});
test('tail first, prepend history without duplicate; successful execution remains unfinished', async ({page}) => {
  await mock(page); await mount(page); await page.getByTestId('workspace-card').first().click(); const host = page.getByTestId('task-feed-scroll'); await expect(page.getByTestId('task-card')).toHaveCount(2); expect(await host.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
  await page.getByRole('button', {name: 'Earlier work items'}).click(); await expect(page.getByTestId('task-card')).toHaveCount(4); await expect(page.getByTestId('task-card').first()).toContainText('Task 1'); await expect(page.getByTestId('task-card').nth(1)).toContainText('Cancelled'); await expect(page.getByTestId('task-card').last()).toContainText('Business status: Open'); await expect(page.getByTestId('task-card').last()).toContainText('Execution succeeded'); await expect(page.getByTestId('task-card').last()).toContainText('no final result yet');
});
test('reading history buffers completion until explicit update without moving viewport', async ({page}) => {
  let changed = false; await mock(page, (path, query) => path === '/workspace/activity/page' && !query.searchParams.has('cursor') && changed ? feed([row('21', 'done', 2), row('22')]) : undefined);
  await mount(page); await page.clock.install(); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'Earlier work items'}).click(); const host = page.getByTestId('task-feed-scroll'); await host.evaluate(el => {el.scrollTop = 0; el.dispatchEvent(new Event('scroll', {bubbles: true}));}); const before = await host.evaluate(el => el.scrollTop); changed = true;
  await page.clock.fastForward(15001); await expect(page.getByRole('button', {name: 'Updates available'})).toBeVisible(); expect(await host.evaluate(el => el.scrollTop)).toBe(before); await expect(page.getByTestId('task-card').nth(2)).toContainText('Business status: Open'); await page.getByRole('button', {name: 'Updates available'}).click(); await expect(page.getByTestId('task-card')).toHaveCount(4); await expect(page.getByTestId('task-card').nth(2)).toContainText('Business status: Done');
});
test('project filter starts fresh tail; readonly keeps employee menu but disables creation', async ({page}) => {
  const requests = await mock(page, path => path === '/workspace/page' ? {list: [space('w', {archived: 1})], total: 1} : undefined); await mount(page); await page.getByTestId('workspace-card').click(); await page.getByRole('combobox', {name: 'Project', exact: true}).selectOption('p'); await expect.poll(() => requests.filter(r => r.path.endsWith('/activity/page')).at(-1)?.query.searchParams.get('projectId')).toBe('p'); expect(requests.filter(r => r.path.endsWith('/activity/page')).at(-1)?.query.searchParams.has('cursor')).toBe(false);
  await page.getByRole('button', {name: 'Manage', exact: true}).click(); await expect(page.getByRole('menuitem', {name: 'Create work item'})).toBeDisabled(); await expect(page.getByRole('menuitem', {name: 'Manage virtual employees'})).toBeEnabled();
});
test('project edit submits version and authorized mappings without workspace authority', async ({page}) => {
  const requests = await mock(page); await mount(page); await page.getByRole('button', {name: 'Manage', exact: true}).click(); await page.getByRole('menuitem', {name: 'Project management'}).click(); await page.getByRole('button', {name: 'Edit', exact: true}).click(); await page.getByLabel('Name', {exact: true}).fill('Renamed'); await expect(page.getByRole('combobox', {name: 'Workspace', exact: true})).toHaveCount(0); await page.getByRole('button', {name: 'Save', exact: true}).click(); await expect.poll(() => requests.filter(r => r.path === '/workspace/project/update').length).toBe(1); expect(requests.find(r => r.path === '/workspace/project/update')?.body).toEqual({id: 'p', name: 'Renamed', version: 7, targets: [{nodeId: 'n', workdirBindingId: 'dir'}]}); expect(requests.some(r => r.path === '/workspace/list')).toBe(false);
});

async function openProjects(page: Page) {
  await mount(page); await page.getByRole('button', {name: 'Manage', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Project management', exact: true}).click();
  await expect(page.getByTestId('project-management')).toBeVisible();
}
async function openProjectSettings(page: Page) {
  await mount(page); await page.getByTestId('workspace-card').first().click();
  await page.getByRole('button', {name: 'Manage', exact: true}).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Create work item', 'Manage virtual employees', 'Space settings']);
  await page.getByRole('menuitem', {name: 'Space settings', exact: true}).click();
  return page.getByTestId('workspace-project-links');
}

test('standalone creation has no spaces dropdown, spaces fetch, or reverse links', async ({page}) => {
  const requests = await mock(page); await openProjects(page);
  const start = requests.length;
  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await expect(page.getByRole('combobox', {name: 'Workspace', exact: true})).toHaveCount(0);
  await page.getByLabel('Name', {exact: true}).fill('Independent');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect.poll(() => requests.filter(r => r.path === '/workspace/project/create').length).toBe(1);
  expect(requests.find(r => r.path === '/workspace/project/create')?.body).toEqual({name: 'Independent', targets: []});
  expect(requests.slice(start).some(r => r.path === '/workspace/list' || r.path === '/workspace/page' || r.path.includes('/link/'))).toBe(false);
  expect(requests.filter(r => r.path === '/workspace/project/page').every(r => !r.query.searchParams.has('workspaceId'))).toBe(true);
});

for (const legacy of [undefined, null, 'foreign-space']) test(`direct project permissions ignore legacy workspace ${legacy}`, async ({page}) => {
  await mock(page, path => path === '/workspace/project/page' ? {list: [
    {...project, id: 'writable', name: 'Writable', workspaceId: legacy, writable: true, manageable: false},
    {...project, id: 'manager', name: 'Manager', workspaceId: legacy, writable: false, manageable: true},
    {...project, id: 'reader', name: 'Reader', workspaceId: 'w', writable: false, manageable: false},
  ], total: 3} : undefined);
  await openProjects(page); const articles = page.getByTestId('project-management').locator('article');
  await expect(articles.nth(0).getByRole('button', {name: 'Edit', exact: true})).toBeEnabled();
  await expect(articles.nth(0).getByRole('button', {name: 'Archived', exact: true})).toBeEnabled();
  await expect(articles.nth(1).getByRole('button', {name: 'Edit', exact: true})).toBeDisabled();
  await expect(articles.nth(1).getByRole('button', {name: 'Archived', exact: true})).toBeDisabled();
  await expect(articles.nth(2).getByRole('button', {name: 'Edit', exact: true})).toBeDisabled();
  await expect(articles.nth(2).getByRole('button', {name: 'Archived', exact: true})).toBeDisabled();
});

test('fresh project detail permissions can revoke editing; save conflicts require reload', async ({page}) => {
  let writable = false;
  const requests = await mock(page, path => path === '/workspace/project/get/p' ? {...project, writable} : path === '/workspace/project/update' ? 'abort' : undefined);
  await openProjects(page); await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await expect(page.getByLabel('Name', {exact: true})).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Save', exact: true})).toBeDisabled();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click(); writable = true;
  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Reload before editing again');
  await expect(page.getByLabel('Name', {exact: true})).toBeDisabled();
  expect(requests.filter(r => r.path === '/workspace/project/update')).toHaveLength(1);
});

test('Settings pages standalone manageable candidates; linking and unlinking preserve project/history', async ({page}) => {
  let linked = [project];
  const candidate = {...project, id: 'p21', name: 'Standalone 21', workspaceId: null};
  const requests = await mock(page, (path, query, body) => {
    if (path === '/workspace/project/list' || path === '/workspace/project/link/list') return linked;
    if (path === '/workspace/project/page') return query.searchParams.get('pageNo') === '2'
      ? {list: [candidate], total: 21}
      : {list: Array.from({length: 20}, (_, index) => ({...project, id: `readonly-${index}`, name: `Not owned ${index}`, manageable: false})), total: 21};
    if (path === '/workspace/project/link/create') {linked = [...linked, candidate]; return {...candidate, id: body.projectId};}
    if (path === '/workspace/project/link/delete') {linked = linked.filter(p => p.id !== query.searchParams.get('projectId')); return null;}
  });
  const panel = await openProjectSettings(page);
  await expect(panel.getByRole('button', {name: 'Unlink project', exact: true})).toBeEnabled();
  await expect(panel.getByRole('button', {name: 'Link project', exact: true})).toHaveCount(0);
  await panel.getByRole('button', {name: 'Load more', exact: true}).click();
  await expect(panel).toContainText('Standalone 21'); await expect(panel).not.toContainText('Not owned');
  await panel.getByRole('button', {name: 'Link project', exact: true}).click();
  await expect(panel.getByRole('button', {name: 'Unlink project', exact: true})).toHaveCount(2);
  const filter = page.getByRole('combobox', {name: 'Project', exact: true});
  await expect(filter.getByRole('option', {name: 'Standalone 21'})).toHaveCount(1); await filter.selectOption('p21');
  await panel.locator('article').filter({hasText: 'Standalone 21'}).getByRole('button', {name: 'Unlink project', exact: true}).click();
  await expect(filter).toHaveValue(''); await expect(filter.getByRole('option', {name: 'Standalone 21'})).toHaveCount(0);
  await expect(page.getByTestId('task-card')).toHaveCount(2);
  expect(requests.filter(r => r.path === '/workspace/project/page').map(r => r.query.searchParams.get('pageNo'))).toEqual(['1', '2']);
  expect(requests.filter(r => r.path === '/workspace/project/page').every(r => !r.query.searchParams.has('workspaceId'))).toBe(true);
  const writes = requests.filter(r => r.method !== 'GET');
  expect(writes.map(r => [r.method, r.path])).toEqual([['POST', '/workspace/project/link/create'], ['DELETE', '/workspace/project/link/delete']]);
  expect(writes[0]?.body).toEqual({workspaceId: 'w', projectId: 'p21'});
  expect(Object.fromEntries(writes[1]!.query.searchParams)).toEqual({workspaceId: 'w', projectId: 'p21'});
  expect(requests.some(r => r.path === '/agent/nodes/grant' || r.path === '/agent/nodes/revoke')).toBe(false);
});

for (const extras of [{myRole: 'member'}, {myRole: 'viewer'}, {archived: 1}]) test(`Settings cannot link without workspace management ${JSON.stringify(extras)}`, async ({page}) => {
  const requests = await mock(page, path => path === '/workspace/page' ? {list: [space('w', extras)], total: 1} : path === '/workspace/project/link/list' ? [project] : undefined);
  const panel = await openProjectSettings(page);
  await expect(panel.getByRole('button', {name: 'Unlink project', exact: true})).toBeDisabled();
  await expect(panel.getByRole('button', {name: 'Link project', exact: true})).toHaveCount(0);
  expect(requests.some(r => r.path === '/workspace/project/page' || r.method !== 'GET')).toBe(false);
});

test('Settings permits unlink without project ownership and fails closed after rejected link', async ({page}) => {
  let rejected = true;
  let linked = [{...project, ownerUserId: 'another-owner', writable: false, manageable: false}];
  const requests = await mock(page, path => {
    if (path === '/workspace/project/link/list' || path === '/workspace/project/list') return linked;
    if (path === '/workspace/project/page') return {list: [{...project, id: 'other', name: 'Other'}], total: 1};
    if (path === '/workspace/project/link/create' && rejected) return 'abort';
    if (path === '/workspace/project/link/delete') {linked = []; return null;}
  });
  const panel = await openProjectSettings(page);
  await expect(panel.getByRole('button', {name: 'Unlink project', exact: true})).toBeEnabled();
  await expect(panel.getByRole('button', {name: 'Edit', exact: true})).toHaveCount(0);
  await panel.getByRole('button', {name: 'Unlink project', exact: true}).click();
  await expect(panel.getByRole('button', {name: 'Unlink project', exact: true})).toHaveCount(0);
  expect(requests.some(r => r.path.startsWith('/workspace/project/get/'))).toBe(false);
  expect(requests.find(r => r.path === '/workspace/project/link/delete')?.method).toBe('DELETE');
  await panel.getByRole('button', {name: 'Link project', exact: true}).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByRole('button', {name: 'Link project', exact: true})).toBeDisabled();
  expect(requests.filter(r => r.path === '/workspace/project/link/create')).toHaveLength(1);
  rejected = false; await panel.getByRole('button', {name: 'Reload', exact: true}).click();
  await expect(panel.getByRole('button', {name: 'Link project', exact: true})).toBeEnabled();
});
test('lost assignment retains saved item and original key; candidates come from associations', async ({page}) => {
  let lost = true; const requests = await mock(page, path => {if (path === '/workspace/work-execution/assign') {if (lost) {lost = false; return 'abort';} return {id: 'link', executionId: 'exec', state: 'accepted'};}}); page.on('dialog', dialog => dialog.accept());
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'Manage', exact: true}).click(); await page.getByRole('menuitem', {name: 'Create work item'}).click(); await page.getByLabel('Title', {exact: true}).fill('Ship'); await page.getByRole('combobox', {name: 'Project', exact: true}).selectOption('p'); await page.getByRole('combobox', {name: 'Employee (optional)', exact: true}).selectOption('emp'); await page.getByRole('button', {name: 'Create and assign'}).click(); await expect(page.getByRole('alert')).toContainText('Work item saved; assignment not confirmed'); await page.getByRole('button', {name: 'Retry', exact: true}).click(); await expect(page.getByTestId('workspace-detail')).toBeVisible();
  const creates = requests.filter(r => r.path === '/workspace/work-item/create'), assigns = requests.filter(r => r.path === '/workspace/work-execution/assign'); expect(creates).toHaveLength(1); expect(assigns).toHaveLength(2); expect(assigns[0]?.body).toEqual(assigns[1]?.body); expect(assigns[0]?.body).toMatchObject({workItemId: '42', employeeId: 'emp', projectTargetId: 'target'}); expect(requests.some(r => r.path === '/agent/agents/send')).toBe(false);
});
test('mobile cards and scoped feed fit phone viewport', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844}); await mock(page); await mount(page); await expect(page.getByTestId('workspace-card')).toHaveCount(2); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.getByTestId('workspace-card').first().click(); await expect(page.getByTestId('task-card')).toHaveCount(2); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const referencePage = (cursor: string | null) => cursor
  ? {items: [{...employee, id: 'ref-101', employeeId: 'employee-101', name: 'Employee 101'}], nextCursor: null, hasMore: false}
  : {items: Array.from({length: 100}, (_, i) => ({...employee, id: `ref-${i + 1}`, employeeId: `employee-${i + 1}`, name: `Employee ${i + 1}`, available: false, unavailableReason: 'offline'})), nextCursor: 'reference-tail-100', hasMore: true};

test('employee management exposes reference 101 through load more and retains all 100 unavailable rows', async ({page}) => {
  const requests = await mock(page, (path, query) => path === '/workspace/employee/page' ? referencePage(query.searchParams.get('cursor')) : undefined);
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'Manage', exact: true}).click(); await page.getByRole('menuitem', {name: 'Manage virtual employees'}).click();
  const panel = page.getByTestId('space-employees'); await expect(panel.locator('article')).toHaveCount(100);
  await panel.getByRole('button', {name: 'Load more', exact: true}).click(); await expect(panel.locator('article')).toHaveCount(101);
  await expect(panel.getByRole('heading', {name: 'Employee 101', exact: true})).toBeVisible(); await expect(panel.locator('article').first()).toContainText('offline');
  expect(requests.filter(r => r.path === '/workspace/employee/page').map(r => r.query.searchParams.get('cursor'))).toEqual([null, 'reference-tail-100']);
});
test('create-item discovers available employee 101 after an entirely unavailable first page without starting work', async ({page}) => {
  const requests = await mock(page, (path, query) => path === '/workspace/employee/page' ? referencePage(query.searchParams.get('cursor')) : undefined);
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'Manage', exact: true}).click(); await page.getByRole('menuitem', {name: 'Create work item'}).click();
  const panel = page.getByTestId('create-work-item'); const select = panel.getByRole('combobox', {name: 'Employee (optional)', exact: true});
  await expect(select.getByRole('option')).toHaveCount(101); await expect(select.getByRole('option', {name: 'Employee 1 · offline', exact: true})).toHaveJSProperty('disabled', true);
  await panel.getByRole('button', {name: 'Load more', exact: true}).click(); await expect(select.getByRole('option')).toHaveCount(102); await select.selectOption('employee-101'); await expect(select).toHaveValue('employee-101');
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

test('blocked accepted create-and-assign stays recoverable across reload without claiming delivery or replacing identity', async ({page}) => {
  const requests = await mock(page, path => path === '/workspace/work-execution/assign' ? {id: 'held-link', executionId: 'accepted-held', state: 'accepted', deliveryBlockedReason: 'INTERNAL_DETAIL_NOT_FOR_DISPLAY'} : undefined);
  page.on('dialog', dialog => dialog.accept());
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'Manage', exact: true}).click(); await page.getByRole('menuitem', {name: 'Create work item'}).click();
  await page.getByLabel('Title', {exact: true}).fill('Held task'); await page.getByRole('combobox', {name: 'Employee (optional)', exact: true}).selectOption('emp'); await page.getByRole('button', {name: 'Create and assign'}).click();
  await expect(page.getByTestId('create-work-item')).toBeVisible(); await expect(page.getByTestId('delivery-blocked')).toContainText('execution delivery is blocked');
  await expect(page.getByTestId('delivery-blocked')).toContainText('accepted-held'); await expect(page.getByTestId('delivery-blocked')).not.toContainText('INTERNAL_DETAIL_NOT_FOR_DISPLAY');
  const first = requests.find(request => request.path === '/workspace/work-execution/assign')!.body;
  await expect(page.getByTestId('delivery-blocked')).toContainText(first.requestId);
  await page.getByRole('button', {name: 'Retry', exact: true}).click(); await expect.poll(() => requests.filter(request => request.path === '/workspace/work-execution/assign').length).toBe(2);
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'Manage', exact: true}).click(); await page.getByRole('menuitem', {name: 'Create work item'}).click();
  await expect(page.getByTestId('delivery-blocked')).toContainText(first.requestId); await page.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect.poll(() => requests.filter(request => request.path === '/workspace/work-execution/assign').length).toBe(3);
  expect(requests.filter(request => request.path === '/workspace/work-item/create')).toHaveLength(1);
  for (const request of requests.filter(request => request.path === '/workspace/work-execution/assign')) expect(request.body).toEqual(first);
});

async function mountNormal(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage('en');
    const {mountNormalWorkspaceConsole} = await import('/src/test-harness/workspace-console.tsx'); mountNormalWorkspaceConsole(`${location.origin}/__v16/app`);
  });
}
async function roomCalls(page: Page) {return page.evaluate(async () => (await import('/src/test-harness/workspace-console.tsx')).normalRoomCalls);}
async function emitRoomChange(page: Page, workspaceId = 'w') {
  await page.evaluate(async workspaceId => {
    const {emitNormalRoomEvent} = await import('/src/test-harness/workspace-console.tsx');
    emitNormalRoomEvent({type: 'channel_publish_received', channel_id: '400', topic: 'workspace.event', payload_text: JSON.stringify({protocolVersion: 1, workspaceId, kind: 'work_item.changed', resourceId: '21', resourceVersion: 2})});
  }, workspaceId);
}

test('normal entry keeps home room-free, subscribes only viewed space, refreshes tail on events and stops on exit/unmount', async ({page}) => {
  let changed = false;
  const requests = await mock(page, (path, query) => path === '/workspace/activity/page'
    ? {...feed([row('21', changed ? 'done' : 'open', changed ? 2 : 1)], false), items: [{...row('21', changed ? 'done' : 'open', changed ? 2 : 1), item: {...item('21', changed ? 'done' : 'open', changed ? 2 : 1), workspaceId: query.searchParams.get('workspaceId')}}]}
    : undefined);
  await mountNormal(page); await expect(page.getByTestId('workspace-card')).toHaveCount(2);
  expect(await roomCalls(page)).toEqual([]); expect(requests.some(request => request.path.includes('/room/'))).toBe(false);
  await page.getByTestId('workspace-card').first().click(); await expect(page.getByTestId('task-card')).toHaveCount(1);
  expect(await roomCalls(page)).toEqual(['observe', 'subscribe:400']);
  const joined = requests.findIndex(request => request.path === '/workspace/room/join'); const snapshot = requests.findIndex(request => request.path === '/workspace/activity/page'); expect(joined).toBeLessThan(snapshot);
  const reads = requests.filter(request => request.path === '/workspace/activity/page').length;
  changed = true; await emitRoomChange(page); await expect(page.getByTestId('task-card')).toContainText('Business status: Done');
  expect(requests.filter(request => request.path === '/workspace/activity/page')).toHaveLength(reads + 1);
  await page.getByTestId('workspace-detail').getByRole('button', {name: 'Back', exact: true}).click(); await expect(page.getByTestId('workspace-home')).toBeVisible();
  await expect.poll(() => roomCalls(page)).toEqual(['observe', 'subscribe:400', 'off', 'unsubscribe:400']);
  const exitedReads = requests.filter(request => request.path === '/workspace/activity/page').length; await emitRoomChange(page); expect(requests.filter(request => request.path === '/workspace/activity/page')).toHaveLength(exitedReads);
  await page.getByTestId('workspace-card').last().click(); await expect(page.getByTestId('task-card')).toHaveCount(1);
  expect(requests.filter(request => request.path === '/workspace/room/join').map(request => request.body.workspaceId)).toEqual(['w', 'other']);
  await page.evaluate(async () => (await import('/src/test-harness/workspace-console.tsx')).unmountNormalWorkspaceConsole());
  await expect.poll(async () => (await roomCalls(page)).filter(call => call === 'unsubscribe:400').length).toBe(2);
  expect(requests.some(request => request.path === '/workspace/work-item/list')).toBe(false);
});

test('normal room event buffers changes while reading history, preserves anchor and ignores other spaces', async ({page}) => {
  let changed = false;
  const requests = await mock(page, (path, query) => path === '/workspace/activity/page' && !query.searchParams.has('cursor') && changed ? feed([row('21', 'done', 2), row('22')]) : undefined);
  await mountNormal(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'Earlier work items'}).click();
  const host = page.getByTestId('task-feed-scroll'); await host.evaluate(el => {el.scrollTop = 0; el.dispatchEvent(new Event('scroll', {bubbles: true}));});
  const anchor = await host.locator('[data-item-id="1"]').evaluate(el => el.getBoundingClientRect().top);
  const reads = requests.filter(request => request.path === '/workspace/activity/page').length;
  changed = true; await emitRoomChange(page, 'other'); expect(requests.filter(request => request.path === '/workspace/activity/page')).toHaveLength(reads);
  await emitRoomChange(page); await expect(page.getByRole('button', {name: 'Updates available'})).toBeVisible();
  await expect(page.getByTestId('task-card').nth(2)).toContainText('Business status: Open');
  expect(await host.locator('[data-item-id="1"]').evaluate(el => el.getBoundingClientRect().top)).toBe(anchor);
  expect(requests.filter(request => request.path === '/workspace/activity/page')).toHaveLength(reads + 1);
  await page.getByRole('button', {name: 'Updates available'}).click(); await expect(page.getByTestId('task-card').nth(2)).toContainText('Business status: Done');
  expect(await host.locator('[data-item-id="1"]').evaluate(el => el.getBoundingClientRect().top)).toBe(anchor);
  expect(requests.filter(request => request.path === '/workspace/activity/page').every(request => request.query.searchParams.get('view') === 'task_feed_v1' && request.query.searchParams.get('limit') === '20')).toBe(true);
});
