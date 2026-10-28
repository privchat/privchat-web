import { test, expect, type Page } from '@playwright/test';
import type { WorkspaceActivity } from '../../src/features/workspace/api';
const space = (id = 'w', extras = {}) => ({id, name: `Space ${id}`, description: 'One line', archived: 0, myRole: 'owner', employeeCount: 3, availableEmployeeCount: 1, employeeAvailabilityKnown: true, openItemCount: 2, lastActivityAt: null, ...extras});
const node = {nodeId: 'n', name: 'Mac', state: 'active', granted: ['agent.codex'], capabilities: [{name: 'agent.codex', available: true}], workdirs: [{id: 'dir', label: 'Repository'}]};
const employee = {id: 'ref', workspaceId: 'w', employeeId: 'emp', name: 'Engineer', nodeId: 'n', capability: 'agent.codex', workdirBindingId: 'dir', available: true, projectTargetIds: ['target']};
const project = {id: 'p', ownerUserId: 'owner', writable: true, manageable: true, name: 'Project', archived: 0, version: 7, targets: [{id: 'target', nodeId: 'n', workdirBindingId: 'dir'}]};
const item = (id: string, status = 'open', version = 1) => ({id, workspaceId: 'w', title: `Task ${id}`, description: '', status, version, createdAt: Number(id), closedAt: ['done', 'cancelled'].includes(status) ? Number(id) : null});
const row = (id: string, status = 'open', version = 1) => ({item: item(id, status, version), latestExecution: {id: `link-${id}`, executionId: `exec-${id}`, employeeId: 'emp', state: 'succeeded'}, executionCount: 2, developerEmployeeId: 'emp', reviewerEmployeeId: null, reviewNoteId: null, stage: ['done', 'cancelled'].includes(status) ? 'closed' : 'development', lastActivityAt: Number(id), needsAttention: false});
const feed = (items: WorkspaceActivity[] = [row('21'), row('22')], more = true) => ({items, olderCursor: more ? 'opaque-w' : null, hasOlder: more, refreshRequired: false});
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
    if (path === '/agent/agents') data = [{agentId: 'reviewer', name: 'Reviewer', executor: 'codex'}, {agentId: 'other-reviewer', name: 'Other reviewer', executor: 'codex'}]; if (path === '/agent/nodes') data = [node]; if (path === '/workspace/agent-binding/list') data = [{id: 'b', nodeId: 'n', capability: 'agent.codex', revoked: 0}];
    if (path === '/workspace/employee/candidates' || path === '/workspace/employee/list') data = [employee]; if (path === '/workspace/work-item/create') data = item('42');
    if (path === '/workspace/employee/page') data = {items: [employee], nextCursor: null, hasMore: false};
    if (path === '/workspace/room/join') data = {channelId: '400', channelType: 3, ticket: 'fixture-room', expiresAt: Date.now() + 60000, eventProtocolVersion: 1};
    if (path === '/workspace/activity/page') {
      const modern = url.searchParams.get('view') !== 'task_feed_v1';
      data = url.searchParams.has('cursor') ? feed([row('1', 'done'), row('2', 'cancelled'), row('21')], false) : feed(modern ? [row('22'), row('21')] : undefined);
    }
    if (path.startsWith('/workspace/work-item/get/')) data = item(path.split('/').at(-1)!);
    const custom = override?.(path, url, body); if (custom === 'abort') {await route.abort(); return;} await route.fulfill({json: {code: 0, data: custom === undefined ? data : custom}});
  }); return requests;
}

const decision = {key: 'decision:q1:1', kind: 'decision', workspaceId: 'w', workItemId: '21', workItemTitle: 'Task 21', summary: 'Continue the bounded work?', createdAt: 3, actionable: true,
  decisionId: 'q1', options: [{id: 'continue', label: 'Continue', description: 'Go on'}, {id: 'stop', label: 'Stop', description: 'Stop here'}], recommendedOptionId: 'stop'};
const approval = {key: 'approval:e2:p1:d', kind: 'approval', workspaceId: 'w', workItemId: '22', workItemTitle: 'Task 22', createdAt: 2, actionable: true,
  summary: JSON.stringify({kind: 'tool', tool: 'session/request_permission', input: {title: 'run tests'}}), executionId: 'e2', permissionId: 'p1', requestDigest: 'd'.repeat(64), options: []};
const opaque = {...approval, key: 'approval:e3:p2:d', executionId: 'e3', permissionId: 'p2', summary: 'run tests', workItemTitle: 'Task 23'};
const failure = {key: 'failure:l4:5', kind: 'failure', workspaceId: 'w', workItemId: '24', workItemTitle: 'Task 24', summary: 'failed', createdAt: 1, actionable: true, state: 'unknown', options: []};
test('inbox lists every waiting fact once and answers each through its own API with a stable request id', async ({page}) => {
  let entries: unknown[] = [decision, approval, opaque, failure]; let fail = true;
  const requests = await mock(page, (path, _query, body) => {
    if (path === '/workspace/inbox/list') return {entries};
    if (path === '/workspace/work-decision/answer') { if (fail) { fail = false; return 'abort'; } entries = entries.filter(e => e !== decision); return {}; }
    if (path === '/agent/permissions/resolve') { entries = entries.filter(e => e !== approval); return {commandId: body.commandId, executionId: 'e2', kind: 'permission.resolve', status: 'pending'}; }
    return undefined;
  });
  page.on('dialog', dialog => void dialog.accept());
  await mount(page); await page.getByTestId('workspace-card').first().click();
  const inbox = page.getByTestId('workspace-inbox');
  await expect(inbox.getByTestId('inbox-entry')).toHaveCount(4);
  await expect(inbox).toContainText('Waiting for you (4)');
  await expect(inbox.locator('[data-kind="failure"]')).toContainText('Result not confirmed');
  // An approval without readable details cannot be allowed remotely, only denied.
  await expect(inbox.locator('[data-kind="approval"]').nth(1).getByRole('button', {name: 'Allow once'})).toBeDisabled();
  const card = inbox.locator('[data-kind="decision"]');
  await card.getByRole('button', {name: /^Stop/}).click();
  await expect(inbox.getByRole('alert')).toBeVisible();
  await card.getByRole('button', {name: /^Stop/}).click();
  await expect(inbox.getByTestId('inbox-entry')).toHaveCount(3);
  const answers = requests.filter(r => r.path === '/workspace/work-decision/answer');
  expect(answers).toHaveLength(2);
  expect(answers[0].body).toEqual(answers[1].body);
  expect(answers[0].body).toMatchObject({decisionId: 'q1', optionId: 'stop'});
  await inbox.locator('[data-kind="approval"]').first().getByRole('button', {name: 'Allow once'}).click();
  await expect(inbox.getByTestId('inbox-entry')).toHaveCount(2);
  expect(requests.find(r => r.path === '/agent/permissions/resolve')?.body).toMatchObject({executionId: 'e2', permissionId: 'p1', requestDigest: 'd'.repeat(64), decision: 'allow_once'});
});
