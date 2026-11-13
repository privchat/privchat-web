import { test, expect, type Page } from '@playwright/test';
import type { WorkspaceActivity } from '../../src/features/workspace/api';
const space = (id = 'w', extras = {}) => ({id, name: `Space ${id}`, description: 'One line', archived: 0, myRole: 'owner', employeeCount: 3, availableEmployeeCount: 1, employeeAvailabilityKnown: true, openItemCount: 2, lastActivityAt: null, ...extras});
const node = {nodeId: 'n', name: 'Mac', state: 'active', granted: ['agent.codex'], capabilities: [{name: 'agent.codex', available: true}], workdirs: [{id: 'dir', label: 'Repository'}]};
const employee = {id: 'ref', workspaceId: 'w', employeeId: 'emp', name: 'Engineer', nodeId: 'n', capability: 'agent.codex', workdirBindingId: 'dir', available: true, projectIds: ['p']};
const myBinding = {id: 'b1', projectId: 'p', userId: 'me', mine: true, nodeId: 'n', nodeName: 'Mac', directories: [{workdirBindingId: 'dir', label: 'Repository', access: 'write'}], notes: '', reviewerEmployeeId: null, version: 1};
const project = {id: 'p', workspaceId: 'w', name: 'Project', archived: 0, version: 7, description: '', manageable: true, roundEnd: '', bindings: []};
const item = (id: string, status = 'open', version = 1) => ({id, workspaceId: 'w', title: `Task ${id}`, description: '', status, version, createdAt: Number(id), closedAt: ['done', 'cancelled'].includes(status) ? Number(id) : null});
const row = (id: string, status = 'open', version = 1) => ({item: item(id, status, version), latestExecution: {id: `link-${id}`, executionId: `exec-${id}`, employeeId: 'emp', state: 'succeeded'}, executionCount: 2, developerEmployeeId: 'emp', reviewerEmployeeId: null, reviewNoteId: null, stage: ['done', 'cancelled'].includes(status) ? 'closed' : 'development', lastActivityAt: Number(id), needsAttention: false});
const feed = (items: WorkspaceActivity[] = [row('21'), row('22')], more = true) => ({items, olderCursor: more ? 'opaque-w' : null, hasOlder: more, refreshRequired: false});
async function mount(page: Page) {
  await page.goto('/'); await page.evaluate(async () => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage('en'); const {mountWorkspacePage} = await import('/src/test-harness/workspace-console.tsx'); mountWorkspacePage(`${location.origin}/__v16/app`);});
}
async function mock(page: Page, override?: (path: string, query: URL, body: any) => unknown) {
  const requests: {path: string; query: URL; method: string; body: any}[] = [];
  await page.route('**/__v16/app/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/__v16/app', ''); const method = route.request().method(); const body = method === 'POST' || method === 'PUT' || method === 'DELETE' ? route.request().postDataJSON() : undefined;
    requests.push({path, query: url, method, body}); let data: unknown = [];
    if (path === '/workspace/page') data = {list: [space(), space('other', {employeeCount: 1, availableEmployeeCount: null, employeeAvailabilityKnown: false})], total: 2};
    if (path === '/workspace/list') data = [space()]; if (path === '/workspace/project/page') data = {list: [project], total: 1}; if (path === '/workspace/project/list') data = [project]; if (path === '/workspace/project/get/p') data = project;
    if (path.startsWith('/workspace/get/')) data = space(path.split('/').at(-1)!);
    if (path === '/workspace/inbox/list') data = {entries: []};
    if (path === '/workspace/member/list') data = [{id: 'm1', workspaceId: 'w', userId: 'owner-user', role: 'owner'}];
    if (path === '/agent/agents') data = [{agentId: 'reviewer', name: 'Reviewer', executor: 'codex', nodeId: 'n', workdirBindingId: 'dir'}, {agentId: 'other-reviewer', name: 'Other reviewer', executor: 'codex'}]; if (path === '/agent/nodes') data = [node]; if (path === '/workspace/agent-binding/list') data = [{id: 'b', nodeId: 'n', capability: 'agent.codex', revoked: 0}];
    if (path === '/workspace/employee/candidates' || path === '/workspace/employee/list') data = [employee]; if (path === '/workspace/work-item/create') data = item('42');
    if (path === '/workspace/employee/page') data = {items: [employee], nextCursor: null, hasMore: false};
    if (path === '/workspace/room/join') data = {channelId: '400', channelType: 3, ticket: 'fixture-room', expiresAt: Date.now() + 60000, eventProtocolVersion: 1};
    if (path === '/workspace/activity/page') data = url.searchParams.has('cursor') ? feed([row('1', 'done'), row('2', 'cancelled'), row('21')], false) : feed();
    if (path.startsWith('/workspace/work-item/get/')) data = item(path.split('/').at(-1)!);
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
test('unified task list pages downward and includes ended work; status chips filter without a separate view', async ({page}) => {
  const requests = await mock(page); await mount(page); await page.getByTestId('workspace-card').first().click();
  const feed = page.locator('[data-testid="task-feed"]:visible');
  await expect(feed.getByTestId('task-card')).toHaveCount(2);
  await expect(feed.getByTestId('task-card').first()).toContainText('Task 21');
  await feed.getByRole('button', {name: 'Load more', exact: true}).click();
  await expect(feed.getByRole('button', {name: 'Load more', exact: true})).toHaveCount(0);
  await expect(feed.getByTestId('task-card')).toHaveCount(4);
  await expect(feed.locator('[data-item-id="1"]')).toContainText('Task 1');
  await expect(feed.locator('[data-item-id="1"]')).toContainText('No project');
  await expect(feed.locator('[data-item-id="2"]')).toContainText('Task 2');
  expect(new Set(requests.filter(r => r.path === '/workspace/activity/page').map(r => r.query.searchParams.get('view')))).toEqual(new Set(['history_tasks_v1']));
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(feed.getByTestId('task-card')).toHaveCount(2);
  await page.getByRole('button', {name: 'All', exact: true}).click();
  await expect(feed.getByTestId('task-card')).toHaveCount(4);
});
test('home buffers updates and preserves surviving card anchor on completion, prepend and pagination', async ({page}) => {
  let changed = false;
  const initial = Array.from({length: 20}, (_, index) => row(String(40 - index)));
  await mock(page, (path, query) => path === '/workspace/activity/page'
    ? query.searchParams.has('cursor') ? feed([row('1', 'done'), row('2', 'cancelled'), row('20')], false)
      : feed(changed ? [row('41'), ...initial.map(r => r.item.id === '36' ? row('36', 'done', 2) : r)] : initial)
    : undefined);
  await mount(page); await page.clock.install(); await page.getByTestId('workspace-card').first().click();
  const active = page.locator('[data-testid="task-feed"]:visible'); const host = active.getByTestId('task-feed-scroll');
  await expect(active.getByTestId('task-card')).toHaveCount(20);
  expect(await host.evaluate(el => el.scrollTop)).toBe(0);
  await host.evaluate(el => {
    const card = el.querySelector('[data-item-id="36"]')!;
    el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top;
    el.dispatchEvent(new Event('scroll', {bubbles: true}));
  });
  const position = () => host.locator('[data-item-id="35"]').evaluate(el => el.getBoundingClientRect().top);
  const before = await position(); changed = true;
  await page.clock.fastForward(15001); await expect(active.getByRole('button', {name: 'Updates available'})).toBeVisible();
  expect(Math.abs(await position() - before)).toBeLessThan(2);
  await active.getByRole('button', {name: 'Updates available'}).click();
  await expect(active.locator('[data-item-id="36"]')).toContainText('Done');
  expect(Math.abs(await position() - before)).toBeLessThan(2);
  await host.evaluate(el => {el.scrollTop = el.scrollHeight;});
  // Measure within the scroll host: clicking the below-the-fold "Load more" button makes Playwright scroll the document, which shifts window-relative rects without moving the feed anchor.
  const offset21 = () => host.evaluate(el => el.querySelector('[data-item-id="21"]')!.getBoundingClientRect().top - el.getBoundingClientRect().top);
  const bottomAnchor = await offset21();
  await active.getByRole('button', {name: 'Load more', exact: true}).click();
  await expect(active.locator('[data-item-id="20"]')).toHaveCount(1);
  expect(Math.abs(await offset21() - bottomAnchor)).toBeLessThan(2);
});
test('project filter starts fresh tail; readonly disables creation but keeps resource navigation', async ({page}) => {
  const requests = await mock(page, path => path === '/workspace/page' ? {list: [space('w', {archived: 1})], total: 1} : path === '/workspace/get/w' ? space('w', {archived: 1}) : undefined); await mount(page); await page.getByTestId('workspace-card').click(); await page.getByRole('combobox', {name: 'Project', exact: true}).selectOption('p'); await expect.poll(() => requests.filter(r => r.path.endsWith('/activity/page')).at(-1)?.query.searchParams.get('projectId')).toBe('p'); expect(requests.filter(r => r.path.endsWith('/activity/page')).at(-1)?.query.searchParams.has('cursor')).toBe(false);
  await expect(page.getByRole('button', {name: 'New task', exact: true})).toBeDisabled();
  await expect(page.getByTestId('ws-nav-navEmployees')).toBeEnabled();
});
test('project edit submits version, description and round-end rules without legacy fields', async ({page}) => {
  const requests = await mock(page); await openProjects(page);
  await page.getByRole('button', {name: 'Project', exact: true}).click();
  await expect(page.getByTestId('project-detail')).toBeVisible();
  await page.getByTestId('project-manage').locator('summary').click(); // Edit form lives in the collapsed management section.
  await page.getByLabel('Name', {exact: true}).fill('Renamed');
  await page.getByLabel('Round-end steps', {exact: true}).fill('commit and push');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect.poll(() => requests.filter(r => r.path === '/workspace/project/update').length).toBe(1);
  expect(requests.find(r => r.path === '/workspace/project/update')?.body).toEqual({id: 'p', name: 'Renamed', version: 7, description: '', roundEnd: 'commit and push'});
});

async function openProjects(page: Page) {
  await mount(page); await page.getByTestId('ws-nav-navProjects').click();
  await expect(page.getByTestId('project-management')).toBeVisible();
}
async function openProjectDetail(page: Page) {
  await openProjects(page);
  await page.getByRole('button', {name: 'Project', exact: true}).click();
  await expect(page.getByTestId('project-detail')).toBeVisible();
}
async function openSettings(page: Page) {
  await mount(page); await page.getByTestId('workspace-card').first().click();
  await page.getByTestId('ws-nav-navMembers').click();
  return page.getByTestId('space-settings');
}

test('project creation requires a manageable workspace and sends no legacy fields', async ({page}) => {
  const requests = await mock(page, (path, _query, body) => {
    if (path === '/workspace/project/create') return {...project, id: 'p-new', name: body.name};
    if (path === '/workspace/project/get/p-new') return {...project, id: 'p-new', name: 'Independent'};
    if (path === '/workspace/list') return [space(), space('viewer', {myRole: 'viewer'}), space('archived', {archived: 1})];
  });
  await openProjects(page);
  await page.getByRole('button', {name: 'Create project', exact: true}).click();
  const form = page.getByTestId('project-create');
  const select = form.getByRole('combobox', {name: 'Workspace', exact: true});
  await expect(select.locator('option')).toHaveCount(2);
  await expect(form.getByRole('button', {name: 'Save', exact: true})).toBeDisabled();
  await select.selectOption('w');
  await page.getByLabel('Name', {exact: true}).fill('Independent');
  await form.getByRole('button', {name: 'Save', exact: true}).click();
  await expect.poll(() => requests.filter(r => r.path === '/workspace/project/create').length).toBe(1);
  expect(requests.find(r => r.path === '/workspace/project/create')?.body).toEqual({workspaceId: 'w', name: 'Independent', description: '', roundEnd: ''});
  await expect(page.getByTestId('project-detail')).toBeVisible();
  expect(requests.some(r => r.path.includes('/link/'))).toBe(false);
});

for (const manageable of [true, false]) test(`project detail editing follows fresh manageable permission (${manageable})`, async ({page}) => {
  await mock(page, path => path === '/workspace/project/get/p' ? {...project, manageable} : undefined);
  await openProjectDetail(page);
  await page.getByTestId('project-manage').locator('summary').click(); // Edit/archive controls live in the collapsed management section.
  const detail = page.getByTestId('project-detail');
  if (manageable) {
    await expect(detail.getByLabel('Name', {exact: true})).toBeEnabled();
    await expect(detail.getByRole('button', {name: 'Archived', exact: true})).toBeEnabled();
  } else {
    await expect(detail.getByLabel('Name', {exact: true})).toHaveCount(0);
    await expect(detail.getByRole('button', {name: 'Archived', exact: true})).toHaveCount(0);
  }
});

test('save conflicts lock the form until reload; revoked management hides editing', async ({page}) => {
  let manageable = true;
  const requests = await mock(page, path => path === '/workspace/project/get/p' ? {...project, manageable} : path === '/workspace/project/update' ? 'abort' : undefined);
  await openProjectDetail(page);
  await page.getByTestId('project-manage').locator('summary').click(); // Edit/reload live in the collapsed management section.
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Reload before editing again');
  await expect(page.getByLabel('Name', {exact: true})).toBeDisabled();
  expect(requests.filter(r => r.path === '/workspace/project/update')).toHaveLength(1);
  manageable = false;
  await page.getByRole('button', {name: 'Reload', exact: true}).click();
  await expect(page.getByLabel('Name', {exact: true})).toHaveCount(0);
});

test('member binding saves directories with access, notes and own reviewer; others see labels only', async ({page}) => {
  let saved = false;
  const other = {id: 'b2', projectId: 'p', userId: 'other-user', mine: false, nodeName: 'Other laptop', directories: [{label: 'Shared repo', access: 'write'}], version: 1};
  const requests = await mock(page, (path, _query, body) => {
    if (path === '/workspace/project/binding/save') {saved = true; return {...myBinding, notes: body.notes, reviewerEmployeeId: body.reviewerEmployeeId ?? null, directories: body.directories.map((d: any) => ({workdirBindingId: d.workdirBindingId, label: 'Repository', access: d.access}))};}
    if (path === '/workspace/project/get/p') return {...project, bindings: saved ? [{...myBinding, notes: 'Handle with care', reviewerEmployeeId: 'reviewer'}, other] : [other]};
  });
  await openProjectDetail(page);
  await page.getByTestId('project-manage').locator('summary').click(); // The binding editor lives in the collapsed management section.
  const detail = page.getByTestId('project-detail');
  const binding = detail.locator('section[aria-label="Directory binding"]');
  await expect(detail).toContainText('No binding yet');
  const others = detail.locator('section[aria-label="Other members’ bindings"]');
  await expect(others).toContainText('Other laptop'); await expect(others).toContainText('Shared repo · Write');
  await expect(others).not.toContainText('b2'); await expect(others).not.toContainText('other-user');
  await binding.getByRole('button', {name: 'Create', exact: true}).click();
  await binding.getByRole('combobox', {name: 'Device', exact: true}).selectOption('n');
  await binding.getByRole('combobox', {name: 'Add directory', exact: true}).selectOption('dir');
  await binding.getByLabel('Notes', {exact: true}).fill('Handle with care');
  await binding.getByRole('combobox', {name: 'Default review employee', exact: true}).selectOption('reviewer');
  await binding.getByRole('button', {name: 'Save', exact: true}).click();
  await expect.poll(() => requests.filter(r => r.path === '/workspace/project/binding/save').length).toBe(1);
  expect(requests.find(r => r.path === '/workspace/project/binding/save')?.body).toEqual({projectId: 'p', nodeId: 'n', directories: [{workdirBindingId: 'dir', access: 'write'}], notes: 'Handle with care', reviewerEmployeeId: 'reviewer'});
  await expect(detail).toContainText('Handle with care');
  await expect(detail).toContainText('Default review employee: reviewer');
  expect(requests.some(r => r.path.includes('/work-note/') || r.path.includes('/work-execution/'))).toBe(false);
});

test('binding edit carries its version; delete keeps history and asks first', async ({page}) => {
  const requests = await mock(page, path => {
    if (path === '/workspace/project/get/p') return {...project, bindings: [myBinding]};
    if (path === '/workspace/project/binding/save') return {...myBinding, version: 2};
    if (path === '/workspace/project/binding/delete') return null;
  });
  page.on('dialog', dialog => dialog.accept());
  await openProjectDetail(page);
  await page.getByTestId('project-manage').locator('summary').click(); // The binding editor lives in the collapsed management section.
  const detail = page.getByTestId('project-detail');
  const binding = detail.locator('section[aria-label="Directory binding"]');
  await binding.getByRole('button', {name: 'Edit', exact: true}).click();
  await binding.getByLabel('Access', {exact: true}).selectOption('read');
  await binding.getByRole('button', {name: 'Save', exact: true}).click();
  await expect.poll(() => requests.filter(r => r.path === '/workspace/project/binding/save').length).toBe(1);
  expect(requests.find(r => r.path === '/workspace/project/binding/save')?.body).toEqual({projectId: 'p', nodeId: 'n', directories: [{workdirBindingId: 'dir', access: 'read'}], notes: '', version: 1});
  await binding.getByRole('button', {name: 'Edit', exact: true}).click();
  await binding.getByRole('button', {name: 'Delete binding', exact: true}).click();
  await expect.poll(() => requests.filter(r => r.path === '/workspace/project/binding/delete').length).toBe(1);
  const removal = requests.find(r => r.path === '/workspace/project/binding/delete')!;
  expect(removal.method).toBe('DELETE');
  expect(Object.fromEntries(removal.query.searchParams)).toEqual({id: 'b1'});
});

test('project detail shows my device directory table and bind dialog saves a verified directory', async ({page}) => {
  let saved = false;
  const requests = await mock(page, (path, _q, body) => {
    if (path === '/workspace/project/binding/save') {saved = true; return {...myBinding, directories: body.directories.map((d: any) => ({workdirBindingId: d.workdirBindingId, label: 'Repository', access: d.access}))};}
    if (path === '/workspace/project/get/p') return {...project, description: 'Personal assistant and node collaboration', bindings: saved ? [{...myBinding, directories: [{workdirBindingId: 'dir', label: 'Repository', access: 'read'}]}] : []};
  });
  await openProjectDetail(page);
  const detail = page.getByTestId('project-detail');
  await expect(detail.getByRole('heading', {name: 'Project', exact: true})).toBeVisible();
  await expect(detail).toContainText('Personal assistant and node collaboration');
  await expect(detail.getByRole('heading', {name: 'My device directories', exact: true})).toBeVisible();
  await expect(detail).toContainText('No binding yet');
  await expect(detail).toContainText('Other members can see task conversations and employee output, which may include paths.');
  await detail.getByRole('button', {name: 'Bind my directories', exact: true}).click();
  const dialog = page.getByRole('dialog').filter({hasText: 'Directories are verified by the selected device.'});
  await expect(dialog.getByRole('heading', {name: 'Bind my directories', exact: true})).toBeVisible();
  await dialog.getByRole('combobox', {name: 'Device node', exact: true}).selectOption('n');
  await dialog.getByRole('combobox', {name: 'Directory path', exact: true}).selectOption('dir');
  await dialog.getByRole('combobox', {name: 'Access', exact: true}).selectOption('read');
  await dialog.getByRole('button', {name: 'Save binding', exact: true}).click();
  await expect.poll(() => requests.filter(r => r.path === '/workspace/project/binding/save').length).toBe(1);
  expect(requests.find(r => r.path === '/workspace/project/binding/save')?.body).toEqual({projectId: 'p', nodeId: 'n', directories: [{workdirBindingId: 'dir', access: 'read'}], notes: ''});
  await expect(detail.getByRole('cell', {name: 'Repository', exact: true})).toBeVisible();
  await expect(detail.getByRole('cell', {name: 'Read', exact: true})).toBeVisible();
});

test('space settings manage members by role through their own APIs', async ({page}) => {
  let role = 'member'; let removed = false;
  const members = [{id: 'm1', workspaceId: 'w', userId: 'owner-user', role: 'owner'}, {id: 'm2', workspaceId: 'w', userId: 'member-user', role: 'member'}];
  const requests = await mock(page, (path, _query, body) => {
    if (path === '/workspace/member/list') return removed ? members.filter(m => m.id !== 'm2') : members.map(m => m.id === 'm2' ? {...m, role} : m);
    if (path === '/workspace/member/update-role') {role = body.role; return {...members[1], role};}
    if (path === '/workspace/member/create') return {id: 'm3', workspaceId: 'w', userId: body.userId, role: body.role};
    if (path === '/workspace/member/delete/m2') {removed = true; return null;}
  });
  page.on('dialog', dialog => dialog.accept());
  const settings = await openSettings(page);
  await expect(settings.getByRole('heading', {name: 'Members', exact: true})).toBeVisible();
  await expect(settings.locator('tbody tr')).toHaveCount(2);
  await expect(settings.locator('tbody tr').first()).toContainText('Owner');
  await settings.getByRole('button', {name: 'member-user', exact: true}).click();
  await settings.getByLabel('Role', {exact: true}).selectOption('admin');
  await expect.poll(() => requests.find(r => r.path === '/workspace/member/update-role')?.body).toEqual({id: 'm2', role: 'admin'});
  await settings.getByRole('button', {name: 'Remove', exact: true}).click();
  await expect(settings.locator('tbody tr')).toHaveCount(1);
  expect(requests.find(r => r.path === '/workspace/member/delete/m2')?.method).toBe('DELETE');
  await settings.getByRole('button', {name: 'Invite member', exact: true}).click();
  await settings.getByLabel('User ID', {exact: true}).fill('new-user');
  await settings.getByRole('button', {name: 'Add member', exact: true}).click();
  await expect.poll(() => requests.find(r => r.path === '/workspace/member/create')?.body).toEqual({workspaceId: 'w', userId: 'new-user', role: 'member'});
});

for (const extras of [{myRole: 'member'}, {myRole: 'viewer'}, {archived: 1}]) test(`settings cannot manage members without workspace management ${JSON.stringify(extras)}`, async ({page}) => {
  const requests = await mock(page, path => path === '/workspace/get/w' ? space('w', extras) : path === '/workspace/member/list' ? [{id: 'm2', workspaceId: 'w', userId: 'member-user', role: 'member'}] : undefined);
  const settings = await openSettings(page);
  await expect(settings.locator('tbody tr')).toHaveCount(1);
  await expect(settings.getByLabel('Role', {exact: true})).toHaveCount(0);
  await expect(settings.getByRole('button', {name: 'Remove', exact: true})).toHaveCount(0);
  await expect(settings.getByRole('button', {name: 'Add member', exact: true})).toHaveCount(0);
  await expect(settings.getByRole('button', {name: 'Invite member', exact: true})).toHaveCount(0);
  expect(requests.some(r => r.method !== 'GET')).toBe(false);
});

test('lost assignment retains saved item and original key; candidates come from associations', async ({page}) => {
  let lost = true; const requests = await mock(page, path => {if (path === '/workspace/work-execution/assign') {if (lost) {lost = false; return 'abort';} return {id: 'link', executionId: 'exec', state: 'accepted'};}}); page.on('dialog', dialog => dialog.accept());
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'New task', exact: true}).click(); await page.getByLabel('Title', {exact: true}).fill('Ship'); await page.getByRole('combobox', {name: 'Project', exact: true}).selectOption('p'); await page.getByRole('combobox', {name: 'Employee (optional)', exact: true}).selectOption('emp'); await page.getByRole('button', {name: 'Create and assign'}).click(); await expect(page.getByRole('alert')).toContainText('Work item saved; assignment not confirmed'); await page.getByRole('button', {name: 'Retry', exact: true}).click(); await expect(page.getByTestId('workspace-detail')).toBeVisible();
  const creates = requests.filter(r => r.path === '/workspace/work-item/create'), assigns = requests.filter(r => r.path === '/workspace/work-execution/assign'); expect(creates).toHaveLength(1); expect(assigns).toHaveLength(2); expect(assigns[0]?.body).toEqual(assigns[1]?.body); expect(assigns[0]?.body).toMatchObject({workItemId: '42', version: 1, employeeId: 'emp', bindingId: 'b'}); expect(requests.some(r => r.path === '/agent/agents/send')).toBe(false);
});
test('mobile cards and scoped feed fit phone viewport', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844}); await mock(page); await mount(page); await expect(page.getByTestId('workspace-card')).toHaveCount(2); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.getByTestId('workspace-card').first().click(); await expect(page.getByTestId('task-card')).toHaveCount(2); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const referencePage = (cursor: string | null) => cursor
  ? {items: [{...employee, id: 'ref-101', employeeId: 'employee-101', name: 'Employee 101'}], nextCursor: null, hasMore: false}
  : {items: Array.from({length: 100}, (_, i) => ({...employee, id: `ref-${i + 1}`, employeeId: `employee-${i + 1}`, name: `Employee ${i + 1}`, available: false, unavailableReason: 'offline'})), nextCursor: 'reference-tail-100', hasMore: true};

test('employee management exposes reference 101 through load more and retains all 100 unavailable rows', async ({page}) => {
  const requests = await mock(page, (path, query) => path === '/workspace/employee/page' ? referencePage(query.searchParams.get('cursor')) : undefined);
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByTestId('ws-nav-navEmployees').click();
  const panel = page.getByTestId('space-employees'); await expect(panel.locator('tbody tr')).toHaveCount(100);
  await panel.getByRole('button', {name: 'Load more', exact: true}).click(); await expect(panel.locator('tbody tr')).toHaveCount(101);
  await expect(panel.getByRole('cell', {name: 'Employee 101', exact: true})).toBeVisible(); await expect(panel.locator('tbody tr').first()).toContainText('Offline');
  expect(requests.filter(r => r.path === '/workspace/employee/page').map(r => r.query.searchParams.get('cursor'))).toEqual([null, 'reference-tail-100']);
});
test('create-item discovers available employee 101 after an entirely unavailable first page without starting work', async ({page}) => {
  const requests = await mock(page, (path, query) => path === '/workspace/employee/page' ? referencePage(query.searchParams.get('cursor')) : undefined);
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'New task', exact: true}).click();
  const panel = page.getByTestId('create-work-item'); const select = panel.getByRole('combobox', {name: 'Employee (optional)', exact: true});
  await expect(select.getByRole('option')).toHaveCount(101); await expect(select.getByRole('option', {name: 'Employee 1 · offline', exact: true})).toHaveJSProperty('disabled', true);
  await panel.getByRole('button', {name: 'Load more', exact: true}).click(); await expect(select.getByRole('option')).toHaveCount(102); await select.selectOption('employee-101'); await expect(select).toHaveValue('employee-101');
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

test('blocked accepted create-and-assign stays recoverable across reload without claiming delivery or replacing identity', async ({page}) => {
  const requests = await mock(page, path => path === '/workspace/work-execution/assign' ? {id: 'held-link', executionId: 'accepted-held', state: 'accepted', deliveryBlockedReason: 'INTERNAL_DETAIL_NOT_FOR_DISPLAY'} : undefined);
  page.on('dialog', dialog => dialog.accept());
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'New task', exact: true}).click();
  await page.getByLabel('Title', {exact: true}).fill('Held task'); await page.getByRole('combobox', {name: 'Employee (optional)', exact: true}).selectOption('emp'); await page.getByRole('button', {name: 'Create and assign'}).click();
  await expect(page.getByTestId('create-work-item')).toBeVisible(); await expect(page.getByTestId('delivery-blocked')).toContainText('execution delivery is blocked');
  await expect(page.getByTestId('delivery-blocked')).toContainText('accepted-held'); await expect(page.getByTestId('delivery-blocked')).not.toContainText('INTERNAL_DETAIL_NOT_FOR_DISPLAY');
  const first = requests.find(request => request.path === '/workspace/work-execution/assign')!.body;
  await expect(page.getByTestId('delivery-blocked')).toContainText(first.requestId);
  await page.getByRole('button', {name: 'Retry', exact: true}).click(); await expect.poll(() => requests.filter(request => request.path === '/workspace/work-execution/assign').length).toBe(2);
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'New task', exact: true}).click();
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
  changed = true; await emitRoomChange(page); await page.getByRole('button', {name: 'Updates available'}).click(); await expect(page.getByTestId('task-card')).toHaveCount(1); await expect(page.getByTestId('task-card')).toContainText('Done');
  expect(requests.filter(request => request.path === '/workspace/activity/page')).toHaveLength(reads + 1);
  await page.locator('nav[aria-label="breadcrumb"] button').first().click(); await expect(page.getByTestId('workspace-home')).toBeVisible();
  await expect.poll(() => roomCalls(page)).toEqual(['observe', 'subscribe:400', 'off', 'unsubscribe:400']);
  const exitedReads = requests.filter(request => request.path === '/workspace/activity/page').length; await emitRoomChange(page); expect(requests.filter(request => request.path === '/workspace/activity/page')).toHaveLength(exitedReads);
  changed = false; await page.getByTestId('workspace-card').last().click(); await expect(page.getByTestId('task-card')).toHaveCount(1);
  expect(requests.filter(request => request.path === '/workspace/room/join').map(request => request.body.workspaceId)).toEqual(['w', 'other']);
  await page.evaluate(async () => (await import('/src/test-harness/workspace-console.tsx')).unmountNormalWorkspaceConsole());
  await expect.poll(async () => (await roomCalls(page)).filter(call => call === 'unsubscribe:400').length).toBe(2);
  expect(requests.some(request => request.path === '/workspace/work-item/list')).toBe(false);
});

test('normal room event buffers changes while reading history, preserves anchor and ignores other spaces', async ({page}) => {
  let changed = false;
  const requests = await mock(page, (path, query) => path === '/workspace/activity/page' && !query.searchParams.has('cursor') && changed ? feed([row('21', 'done', 2), row('22')]) : undefined);
  await mountNormal(page); await page.getByTestId('workspace-card').first().click(); const records = page.locator('[data-testid="task-feed"]:visible'); await expect(records.getByTestId('task-card')).toHaveCount(2); await records.getByRole('button', {name: 'Load more', exact: true}).click();
  const host = records.getByTestId('task-feed-scroll'); await host.evaluate(el => {el.scrollTop = 0; el.dispatchEvent(new Event('scroll', {bubbles: true}));});
  const anchor = await host.locator('[data-item-id="22"]').evaluate(el => el.getBoundingClientRect().top);
  const reads = requests.filter(request => request.path === '/workspace/activity/page').length;
  changed = true; await emitRoomChange(page, 'other'); expect(requests.filter(request => request.path === '/workspace/activity/page')).toHaveLength(reads);
  await emitRoomChange(page); await expect(records.getByRole('button', {name: 'Updates available'})).toBeVisible();
  await expect(records.locator('[data-item-id="21"]')).toContainText('Task 21');
  expect(await host.locator('[data-item-id="22"]').evaluate(el => el.getBoundingClientRect().top)).toBe(anchor);
  expect(requests.filter(request => request.path === '/workspace/activity/page')).toHaveLength(reads + 2);
  await records.getByRole('button', {name: 'Updates available'}).click(); await expect(records.locator('[data-item-id="21"]')).toContainText('Done');
  expect(await host.locator('[data-item-id="22"]').evaluate(el => el.getBoundingClientRect().top)).toBe(anchor);
  expect(requests.filter(request => request.path === '/workspace/activity/page').every(request => ['active_tasks_v1', 'history_tasks_v1'].includes(request.query.searchParams.get('view')!) && request.query.searchParams.get('limit') === '20')).toBe(true);
});

test('project task list reads all permitted spaces without reverse workspace lookup; details read a single item', async ({page}) => {
  const requests = await mock(page, path => path === '/workspace/activity/page' ? feed([
    {...row('21'), item: {...item('21'), projectId: 'p'}},
    {...row('22', 'done'), item: {...item('22', 'done'), projectId: 'p'}},
  ], false) : undefined);
  await openProjects(page); const start = requests.length;
  await page.getByRole('button', {name: 'Project', exact: true}).click();
  await page.getByTestId('project-manage').locator('summary').click(); // Task records lives in the collapsed management section.
  await page.getByRole('button', {name: 'Task records', exact: true}).click();
  const history = page.getByTestId('task-history'); await expect(history.getByTestId('task-card')).toHaveCount(2);
  const read = requests.filter(r => r.path === '/workspace/activity/page').at(-1)!;
  expect(Object.fromEntries(read.query.searchParams)).toEqual({view: 'history_tasks_v1', projectId: 'p', limit: '20'});
  expect(requests.slice(start).some(r => ['/workspace/page', '/workspace/list'].includes(r.path))).toBe(false);
  await history.getByRole('button', {name: 'Task 21', exact: true}).click();
  await expect.poll(() => requests.some(r => r.path === '/workspace/work-item/get/21')).toBe(true);
  expect(requests.some(r => r.path === '/workspace/work-item/list')).toBe(false);
  await expect(page.getByTestId('workflow-panel')).toHaveCount(1);
});

test('employee task list is scoped by employee across visible spaces, not by the currently selected workspace', async ({page}) => {
  const requests = await mock(page, path => path === '/workspace/activity/page' ? feed([row('21'), row('22', 'done')], false) : undefined);
  await mount(page); await page.getByTestId('workspace-card').first().click();
  await page.getByTestId('ws-nav-navEmployees').click();
  await expect(page.getByTestId('space-employees').locator('tbody tr').first()).toContainText('Idle');
  await page.getByTestId('space-employees').locator('tbody tr').first().getByRole('button', {name: 'Engineer', exact: true}).click();
  await page.getByTestId('space-employees').getByRole('button', {name: 'Task records', exact: true}).click();
  await expect(page.getByTestId('task-history').getByTestId('task-card')).toHaveCount(2);
  expect(Object.fromEntries(requests.filter(r => r.path === '/workspace/activity/page').at(-1)!.query.searchParams)).toEqual({view: 'history_tasks_v1', employeeId: 'emp', limit: '20'});
});

test('cards use projected roles and reviewNoteId, retain server order and never expose stage codes or duplicate progress prose', async ({page}) => {
  await mock(page, path => path === '/workspace/activity/page' ? feed([
    {...row('21'), developerEmployeeId: 'dev-a', reviewerEmployeeId: 'reviewer-c', reviewNoteId: null, stage: 'development'},
    {...row('22'), developerEmployeeId: 'dev-b', reviewerEmployeeId: 'reviewer-c', reviewNoteId: 'review-note', stage: 'reviewing', needsAttention: true},
    {...row('23'), stage: 'future_machine_stage'},
  ], false) : undefined);
  await mount(page); await page.getByTestId('workspace-card').first().click(); const cards = page.getByTestId('task-card');
  await expect(cards).toHaveCount(3); await expect(cards.first()).toContainText('Task 21');
  await expect(cards.first()).toContainText('dev-a');
  await expect(cards.nth(1)).toContainText('dev-b');
  await expect(cards.nth(1)).toContainText('Needs attention');
  await expect(cards.nth(2)).toContainText('Stage unavailable');
  for (const [locale, development, reviewing] of [['en', 'In development', 'Under review'], ['zh-CN', '开发中', '评审中'], ['zh-TW', '開發中', '評審中'], ['vi', 'Đang phát triển', 'Đang đánh giá']]) {
    await page.evaluate(async locale => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage(locale);}, locale);
    await expect(cards.first()).toContainText(development!); await expect(cards.nth(1)).toContainText(reviewing!);
    await expect(page.getByTestId('task-feed')).not.toContainText(/Latest stage: development|Latest stage: reviewing|future_machine_stage|no final result|Latest execution:/);
  }
});

test('unified task list refresh removes old cards when the feed empties', async ({page}) => {
  let empty = false;
  await mock(page, path => path === '/workspace/activity/page' ? feed(empty ? [] : [row('21')], false) : undefined);
  await mount(page); await page.clock.install(); await page.getByTestId('workspace-card').first().click();
  const list = page.locator('[data-testid="task-feed"]:visible'); await expect(list.getByTestId('task-card')).toHaveCount(1);
  empty = true; await page.clock.fastForward(15001);
  await list.getByRole('button', {name: 'Updates available'}).click();
  await expect(list.getByTestId('task-card')).toHaveCount(0);
});

test('snapshot invalidation fetches a fresh first page; failed paging retains original cursor and denied reads clear cards', async ({page}) => {
  let invalidate = true, fail = false;
  const requests = await mock(page, (path, query) => {
    if (path !== '/workspace/activity/page') return;
    if (query.searchParams.has('cursor') && invalidate) return {...feed([], false), refreshRequired: true};
    if (fail) return 'abort';
    return feed([row(query.searchParams.has('cursor') ? '20' : '21')], !query.searchParams.has('cursor'));
  });
  await mount(page); await page.clock.install(); await page.getByTestId('workspace-card').first().click(); const active = page.locator('[data-testid="task-feed"]:visible');
  await active.getByRole('button', {name: 'Load more', exact: true}).click();
  await expect(active.getByRole('button', {name: 'Updates available'})).toBeVisible(); invalidate = false;
  await active.getByRole('button', {name: 'Updates available'}).click();
  await expect(active.getByRole('button', {name: 'Updates available'})).toHaveCount(0);
  expect(requests.filter(r => r.path === '/workspace/activity/page').at(-1)!.query.searchParams.has('cursor')).toBe(false);
  fail = true; await active.getByRole('button', {name: 'Load more', exact: true}).click(); await expect(active.getByRole('alert')).toBeVisible();
  await expect(active.getByTestId('task-card')).toHaveCount(1); fail = false;
  await active.getByRole('button', {name: 'Load more', exact: true}).click(); await expect(active.getByTestId('task-card')).toHaveCount(2);
  expect(requests.filter(r => r.path === '/workspace/activity/page' && r.query.searchParams.has('cursor')).map(r => r.query.searchParams.get('cursor'))).toEqual(['opaque-w', 'opaque-w', 'opaque-w']);
  await page.route('**/__v16/app/workspace/activity/page?**', route => route.fulfill({json: {code: 403, message: 'FORBIDDEN'}}));
  await page.clock.fastForward(15001); await expect(active.getByTestId('task-card')).toHaveCount(0);
});

for (const authorized of [true, false]) test(`default review selection uses the caller's own binding and cannot grant missing access (${authorized})`, async ({page}) => {
  const requests = await mock(page, path => {
    if (path === '/workspace/activity/page') return feed([{...row('21'), item: {...item('21'), projectId: 'p'}, reviewerEmployeeId: 'reviewer'}], false);
    if (path === '/workspace/work-item/get/21') return {...item('21'), projectId: 'p'};
    if (path === '/workspace/project/get/p') return {...project, bindings: [{...myBinding, reviewerEmployeeId: 'reviewer'}]};
    if (path === '/workspace/employee/page') return {items: authorized ? [employee, {...employee, id: 'review-ref', employeeId: 'reviewer', name: 'Reviewer'}] : [employee], nextCursor: null, hasMore: false};
  });
  await mount(page); await page.getByTestId('workspace-card').first().click(); await page.getByRole('button', {name: 'Task 21', exact: true}).click();
  await page.getByTestId('task-manage').locator('summary').click(); // Assignment/review live in the collapsed management section.
  const workflow = page.getByTestId('workflow-panel'); const selectDefault = workflow.getByRole('button', {name: 'Default review employee: reviewer', exact: true});
  if (authorized) {
    await expect(selectDefault).toBeEnabled(); await selectDefault.click();
    await expect(workflow.getByRole('combobox').first()).toHaveValue('reviewer');
    await expect(workflow.getByRole('button', {name: 'Request employee review', exact: true})).toBeDisabled();
  } else await expect(selectDefault).toBeDisabled();
  expect(requests.some(r => r.method !== 'GET')).toBe(false);
  expect(requests.some(r => r.path === '/workspace/work-item/list')).toBe(false);
});

test('pending, blocked and handoff stages stay distinct from development; missing and unknown stages never infer from accepted or failed', async ({page}) => {
  const cases = [
    {stage: 'development_pending', state: 'accepted'},
    {stage: 'development_blocked', state: 'failed'},
    {stage: 'waiting_user', state: 'waiting_permission'},
    {stage: 'awaiting_review', state: 'succeeded'},
    {stage: 'awaiting_acceptance', state: 'succeeded'},
    {stage: 'future_stage', state: 'accepted'},
    {stage: null, state: 'failed'},
  ];
  await mock(page, path => path === '/workspace/activity/page' ? feed(cases.map(({stage, state}, index) => ({...row(String(index + 21)), stage, latestExecution: {...row('21').latestExecution, state}})), false) : undefined);
  await mount(page); await page.getByTestId('workspace-card').first().click();
  const cards = page.getByTestId('task-card'); await expect(cards).toHaveCount(cases.length);
  for (const [locale, labels] of [
    ['en', ['Awaiting development execution', 'Development needs attention', 'Waiting for user action', 'Awaiting review', 'Awaiting acceptance', 'Stage unavailable']],
    ['zh-CN', ['等待开发执行', '开发待处理', '等待用户处理', '待评审', '待验收', '阶段暂不可读']],
    ['zh-TW', ['等待開發執行', '開發待處理', '等待使用者處理', '待評審', '待驗收', '階段暫不可讀']],
    ['vi', ['Chờ thực thi phát triển', 'Phát triển cần xử lý', 'Chờ người dùng xử lý', 'Chờ đánh giá', 'Chờ nghiệm thu', 'Chưa đọc được giai đoạn']],
  ] as const) {
    await page.evaluate(async locale => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage(locale);}, locale);
    for (let index = 0; index < cases.length; index++) await expect(cards.nth(index)).toContainText(labels[Math.min(index, 5)]!);
    await expect(page.getByTestId('task-feed')).not.toContainText(/development_pending|development_blocked|waiting_user|awaiting_review|awaiting_acceptance|future_stage|Latest stage: In development|最新阶段: 开发中|最新階段: 開發中/);
  }
});

test('closed stage shows business Done or Cancelled, while open work with a closed projection stays unknown', async ({page}) => {
  await mock(page, path => path === '/workspace/activity/page' ? feed([
    {...row('21', 'done'), stage: 'closed'},
    {...row('22', 'cancelled'), stage: 'closed'},
    {...row('23'), stage: 'closed'},
  ], false) : undefined);
  await mount(page); await page.getByTestId('workspace-card').first().click();
  const records = page.locator('[data-testid="task-feed"]:visible');
  await expect(records.getByTestId('task-card')).toHaveCount(3);
  await expect(records.locator('[data-item-id="21"]')).toContainText('Latest stage: Done');
  await expect(records.locator('[data-item-id="22"]')).toContainText('Latest stage: Cancelled');
  await expect(records.locator('[data-item-id="23"]')).toContainText('Latest stage: Stage unavailable');
  await expect(records).not.toContainText('Latest stage: Closed');
});
