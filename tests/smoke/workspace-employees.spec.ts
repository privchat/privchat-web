import { test, expect, type Page } from '@playwright/test';

const employee = {agentId: 'employee-1', name: 'Alex', title: 'Reviewer', roleDescription: 'Review carefully', nodeId: 'remote-1', executor: 'codex', model: 'configured-model', workdirBindingId: 'repo', config: {}, createdAt: 1};
const execution = {executionId: 'session-1', nodeId: 'remote-1', capability: 'agent.codex', scope: {kind: 'private', ref: ''}, state: 'succeeded', stateVersion: 1, nativeSessionId: 'native-1', updatedAt: 1, createdAt: 1, params: {model: 'configured-model', workdirBindingId: 'repo', title: 'Existing review'}};
const nodes = [{nodeId: 'remote-1', name: 'Remote laptop', state: 'active', granted: ['agent.codex', 'agent.claude', 'code.codex', 'workspace_events_read', 'unknown'], capabilities: [{name: 'agent.codex', available: true}, {name: 'agent.claude', available: true}, {name: 'code.codex', available: true}], workdirs: [{id: 'repo', label: 'Project'}], sessionDiscovery: {external: false, reason: 'executor_discovery_unverified'}}, {nodeId: 'offline', name: 'Offline laptop', state: 'offline', granted: ['agent.codex'], workdirs: []}];

async function mount(page: Page, initial: unknown[] = [], sessions: unknown[] = [], reply?: (path: string, body: Record<string, unknown>, attempt: number) => unknown) {
  const posts: {path: string; body: Record<string, unknown>}[] = [];
  await page.goto('/');
  await page.route('**/__employees/app/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__employees/app', '');
    const isPost = route.request().method() === 'POST';
    const body = isPost ? route.request().postDataJSON() : {};
    if (isPost) posts.push({path, body});
    let data: unknown = [];
    if (path === '/agent/nodes') data = nodes;
    if (path === '/agent/agents' && !isPost) data = initial;
    if (path === '/agent/executions/list') data = sessions;
    if (path === '/agent/executions/get') data = execution;
    if (path === '/agent/executions/children') data = {items: []};
    if (isPost) {
      data = reply ? reply(path, body, posts.filter(p => p.path === path).length) : path.endsWith('/send') ? execution : {...employee, ...body};
      if (data === 'abort') {await route.abort(); return;}
      if (data && typeof data === 'object' && 'errorCode' in data) {await route.fulfill({json: {code: data.errorCode, message: 'REQUEST_REJECTED'}}); return;}
    }
    await route.fulfill({json: {code: 0, data}});
  });
  await page.evaluate(async () => {
    const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage('en');
    const {mountWorkspaceConsole} = await import('/src/test-harness/workspace-console.tsx');
    mountWorkspaceConsole(`${location.origin}/__employees/app`);
  });
  const panel = page.getByTestId('employee-panel');
  await expect(panel.getByRole('button', {name: 'Refresh', exact: true})).toBeEnabled();
  return {panel, posts};
}

async function fillConfig(panel: ReturnType<Page['getByTestId']>) {
  await panel.getByRole('textbox', {name: 'Name', exact: true}).fill('Alex');
  await panel.getByRole('textbox', {name: 'Job title', exact: true}).fill('Reviewer');
  await panel.getByRole('textbox', {name: 'Role instructions', exact: true}).fill('Review carefully');
  await panel.getByRole('combobox', {name: /^Devices/}).selectOption('remote-1');
  await panel.getByRole('combobox', {name: /^Executor/}).selectOption('codex');
  await panel.getByRole('textbox', {name: 'Model', exact: true}).fill('configured-model');
  await panel.getByRole('combobox', {name: /^Work directory binding/}).selectOption('repo');
}

test('creates config only, keeps title separate from role and uses supplied workdir IDs', async ({page}) => {
  const {panel, posts} = await mount(page);
  await expect(panel.getByTestId('external-discovery-unsupported')).toContainText('not supported');
  await expect(panel.getByRole('button', {name: 'Create employee', exact: true})).toBeDisabled();
  await fillConfig(panel);
  await expect(panel.getByRole('combobox', {name: /^Executor/}).locator('option')).toHaveCount(3);
  await expect(panel.getByRole('option', {name: /Offline laptop/})).toHaveAttribute('disabled', '');
  await panel.getByRole('button', {name: 'Create employee', exact: true}).click();
  await expect(panel.getByRole('status')).toHaveText('Employee configuration saved. No model task was started.');
  expect(posts).toHaveLength(1);
  expect(posts[0].path).toBe('/agent/agents');
  expect(posts[0].body).toMatchObject({name: 'Alex', title: 'Reviewer', roleDescription: 'Review carefully', nodeId: 'remote-1', executor: 'codex', workdirBindingId: 'repo', model: 'configured-model'});
  expect(posts[0].body).not.toHaveProperty('text');
  expect(posts[0].body.requestId).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
});

test('binding excludes non-private, live, external, mismatched and already-bound sessions; requires confirmation', async ({page}) => {
  const sessions = [execution, {...execution, executionId: 'wrong-model', params: {...execution.params, model: 'other'}}, {...execution, executionId: 'wrong-workdir', params: {...execution.params, workdirBindingId: 'other'}}, {...execution, executionId: 'missing-params', params: undefined}, {...execution, executionId: 'running', state: 'running'}, {...execution, executionId: 'workspace', scope: {kind: 'workspace', ref: 'w'}}, {...execution, executionId: 'external', nativeSessionId: null}, {...execution, executionId: 'other-node', nodeId: 'other'}, {...execution, executionId: 'other-executor', capability: 'agent.claude'}, {...execution, executionId: 'bound', agentId: 'another'}];
  const {panel, posts} = await mount(page, [], sessions.map(e => e.executionId === execution.executionId ? e : {...e, nativeSessionId: e.nativeSessionId ? `native-${e.executionId}` : null}));
  await fillConfig(panel);
  const select = panel.getByRole('combobox', {name: /^Managed session/});
  await expect(select.locator('option')).toHaveCount(2);
  await select.selectOption('session-1');
  const create = panel.getByRole('button', {name: 'Create employee', exact: true});
  await expect(create).toBeDisabled();
  await panel.getByRole('checkbox').check();
  await create.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body.bindExecutionId).toBe('session-1');
  expect(posts[0].path).toBe('/agent/agents');
  expect(posts[0].body).not.toHaveProperty('nativeSessionId');
});

test('ambiguous creation retries exact key and body and locks configuration', async ({page}) => {
  const {panel, posts} = await mount(page, [], [], (_path, body, attempt) => attempt === 1 ? 'abort' : {...employee, ...body});
  await fillConfig(panel);
  await panel.getByRole('button', {name: 'Create employee', exact: true}).click();
  await expect(panel.getByRole('alert')).toContainText('Outcome unknown');
  await expect(panel.getByRole('textbox', {name: 'Name', exact: true})).toBeDisabled();
  await expect(panel.getByRole('combobox', {name: /^Virtual employees/})).toBeDisabled();
  await panel.getByRole('button', {name: 'Retry same request'}).click();
  await expect(panel.getByRole('status')).toContainText('configuration saved');
  expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
});

test('metadata updates preserve routing, and employee messages use IDs and the employee send endpoint', async ({page}) => {
  let turn = 0;
  const {panel, posts} = await mount(page, [employee], [], (path, body) => path.endsWith('/send') ? {...execution, executionId: `turn-${++turn}`} : {...employee, ...body});
  await panel.getByRole('combobox', {name: /^Virtual employees/}).selectOption('employee-1');
  await panel.getByRole('button', {name: 'Edit employee', exact: true}).click();
  await panel.getByRole('textbox', {name: 'Name', exact: true}).fill('Renamed');
  await panel.getByRole('textbox', {name: 'Job title', exact: true}).fill('Engineer');
  await expect(panel.getByRole('combobox', {name: /^Executor/})).toHaveCount(0);
  await panel.getByRole('button', {name: 'Save employee', exact: true}).click();
  await expect(panel.getByRole('status')).toContainText('configuration saved');
  expect(posts[0]).toMatchObject({path: '/agent/agents/update', body: {agentId: employee.agentId, nodeId: employee.nodeId, executor: employee.executor, model: employee.model, workdirBindingId: employee.workdirBindingId, roleDescription: employee.roleDescription, name: 'Renamed', title: 'Engineer'}});
  // The public request excludes stored config/timestamps, while retaining immutable routing.
  expect(posts[0].body).not.toHaveProperty('config');
  for (const text of ['First message', 'Next turn']) {
    await panel.getByRole('textbox', {name: 'Message to employee', exact: true}).fill(text);
    await panel.getByRole('button', {name: 'Send message', exact: true}).click();
    await expect(panel.getByRole('textbox', {name: 'Message to employee', exact: true})).toHaveValue('');
  }
  const sends = posts.filter(p => p.path.endsWith('/send'));
  expect(sends).toHaveLength(2);
  expect(sends.map(s => s.body.agentId)).toEqual(['employee-1', 'employee-1']);
  expect(sends[0].body).not.toHaveProperty('name');
  expect(sends[0].body.requestId).not.toBe(sends[1].body.requestId);
  await expect(panel.getByTestId('session-console')).toBeVisible();
  await expect(panel.getByRole('button', {name: 'Send follow-up', exact: true})).toHaveCount(0);
});

test('ambiguous send preserves message and key, with no duplicate session start endpoint', async ({page}) => {
  const {panel, posts} = await mount(page, [employee], [], (_path, _body, attempt) => attempt === 1 ? 'abort' : execution);
  await panel.getByRole('combobox', {name: /^Virtual employees/}).selectOption('employee-1');
  await panel.getByRole('textbox', {name: 'Message to employee', exact: true}).fill('Do the work');
  await panel.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect(panel.getByRole('alert')).toContainText('Outcome unknown');
  await expect(panel.getByRole('textbox', {name: 'Message to employee', exact: true})).toBeDisabled();
  await panel.getByRole('button', {name: 'Retry same request'}).click();
  await expect(panel.getByRole('textbox', {name: 'Message to employee', exact: true})).toHaveValue('');
  expect(posts[0]).toEqual(posts[1]); expect(posts.every(p => p.path === '/agent/agents/send')).toBe(true);
});

test('employee HTTP adapters keep platform auth, paths and encoded node IDs', async ({page}) => {
  const requests: {path: string; auth: string | undefined; body: unknown}[] = [];
  await page.goto('/');
  await page.route('**/__adapter/app/**', async route => {
    requests.push({path: new URL(route.request().url()).pathname + new URL(route.request().url()).search, auth: route.request().headers().authorization, body: route.request().method() === 'POST' ? route.request().postDataJSON() : null});
    await route.fulfill({json: {code: 0, data: []}});
  });
  await page.evaluate(async () => {
    const {WorkspaceApi} = await import('/src/features/workspace/api.ts');
    const api = new WorkspaceApi(`${location.origin}/__adapter/app`, () => 'token');
    const config = {requestId: 'request-123', name: 'Name', title: 'Title', roleDescription: 'Role', nodeId: 'remote', executor: 'codex', model: 'model', workdirBindingId: 'repo'};
    await api.employees(); await api.createEmployee(config); await api.updateEmployee({...config, agentId: 'a'}); await api.sendEmployee({agentId: 'a', requestId: 'request-456', text: 'hello'}); await api.executions('node/a b');
  });
  expect(requests.map(r => r.path)).toEqual(['/__adapter/app/agent/agents', '/__adapter/app/agent/agents', '/__adapter/app/agent/agents/update', '/__adapter/app/agent/agents/send', '/__adapter/app/agent/executions/list?nodeId=node%2Fa%20b']);
  expect(requests.every(r => r.auth === 'Bearer token')).toBe(true);
});

for (const [language, title] of [['en', 'Virtual employees'], ['zh-CN', '虚拟员工'], ['vi', 'Nhân viên ảo']]) {
  test(`employee panel is localized and fits phone viewport (${language})`, async ({page}, testInfo) => {
    await page.setViewportSize({width: 390, height: 844});
    const {panel} = await mount(page);
    await page.evaluate(async language => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage(language);}, language);
    await expect(panel.getByRole('heading', {name: title})).toBeVisible();
    await expect(panel).not.toContainText('agentWorkspace.');
    const box = await panel.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await panel.getByRole('heading', {name: title}).scrollIntoViewIfNeeded();
    await page.screenshot({path: testInfo.outputPath('employee-mobile.png')});
  });
}

test('definite validation rejection allows correction with a new request key', async ({page}) => {
  const {panel, posts} = await mount(page, [], [], (_path, body, attempt) => attempt === 1 ? {errorCode: 10100} : {...employee, ...body});
  await fillConfig(panel);
  await panel.getByRole('button', {name: 'Create employee', exact: true}).click();
  await expect(panel.getByRole('alert')).toContainText('Request failed');
  await panel.getByRole('textbox', {name: 'Name', exact: true}).fill('Corrected');
  await panel.getByRole('button', {name: 'Create employee', exact: true}).click();
  await expect(panel.getByRole('status')).toContainText('configuration saved');
  expect(posts).toHaveLength(2);
  expect(posts[0].body.requestId).not.toBe(posts[1].body.requestId);
  expect(posts[1].body.name).toBe('Corrected');
});

test('unknown send followed by auth rejection retains recovery key and blocks dialog close', async ({page}) => {
  const {panel, posts} = await mount(page, [employee], [], (_path, _body, attempt) => attempt === 1 ? 'abort' : attempt === 2 ? {errorCode: 401} : execution);
  await panel.getByRole('combobox', {name: /^Virtual employees/}).selectOption('employee-1');
  await panel.getByRole('textbox', {name: 'Message to employee', exact: true}).fill('Keep original text');
  await panel.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect(panel.getByRole('alert')).toContainText('Outcome unknown');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await panel.getByRole('button', {name: 'Retry same request'}).click();
  await expect(panel.getByRole('button', {name: 'Retry same request'})).toBeEnabled();
  await panel.getByRole('button', {name: 'Retry same request'}).click();
  await expect(panel.getByRole('textbox', {name: 'Message to employee', exact: true})).toHaveValue('');
  expect(posts).toHaveLength(3); expect(posts[0]).toEqual(posts[1]); expect(posts[1]).toEqual(posts[2]);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('binding confirmation resets when model or workdir changes and submits no raw native identifier', async ({page}) => {
  const {panel, posts} = await mount(page, [], [execution]);
  await fillConfig(panel);
  const sessions = panel.getByRole('combobox', {name: /^Managed session/});
  await sessions.selectOption('session-1'); await panel.getByRole('checkbox').check();
  await panel.getByRole('textbox', {name: 'Model', exact: true}).fill('another-model');
  await expect(sessions).toHaveValue(''); await expect(sessions.locator('option')).toHaveCount(1);
  await panel.getByRole('textbox', {name: 'Model', exact: true}).fill('configured-model');
  await sessions.selectOption('session-1'); await expect(panel.getByRole('checkbox')).not.toBeChecked();
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', {name: 'Create employee', exact: true}).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(Object.keys(posts[0].body).sort()).toEqual(['bindExecutionId', 'executor', 'model', 'name', 'nodeId', 'requestId', 'roleDescription', 'title', 'workdirBindingId'].sort());
  expect(JSON.stringify(posts[0].body)).not.toContain('native-1');
});

test('unsupported employee API has an explicit state and refresh recovers', async ({page}) => {
  const {panel} = await mount(page);
  await page.route('**/__employees/app/agent/agents', async route => {await route.fulfill({status: 404, body: ''});});
  await panel.getByRole('button', {name: 'Refresh', exact: true}).click();
  await expect(panel.getByRole('alert')).toContainText('does not support');
  await page.unroute('**/__employees/app/agent/agents');
  // Reinstall the single endpoint after removing the failing handler.
  await page.route('**/__employees/app/agent/agents', async route => {await route.fulfill({json: {code: 0, data: []}});});
  await panel.getByRole('button', {name: 'Refresh', exact: true}).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('only verified agent capabilities map to executor names', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {employeeExecutor} = await import('/src/features/workspace/employees.tsx');
    return ['agent.claude', 'agent.codex', 'code.claude', 'code.codex', 'agent.paseo', 'coding'].map(c => employeeExecutor(c) ?? null);
  });
  expect(result).toEqual(['claude', 'codex', null, null, null, null]);
});

test('binding candidates dedupe native sessions and exclude every busy, unknown or owned session', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async ({execution, employee}) => {
    const {bindingCandidates} = await import('/src/features/workspace/employees.tsx');
    const candidate = (nativeSessionId: string, executionId: string, updatedAt: number, extra = {}) => ({...execution, nativeSessionId, executionId, updatedAt, ...extra});
    const rows = [
      candidate('deduped', 'old', 1), candidate('deduped', 'latest', 10),
      candidate('busy', 'busy-old', 1), candidate('busy', 'busy-new', 2, {state: 'running'}),
      candidate('unknown', 'unknown-old', 1), candidate('unknown', 'unknown-new', 2, {state: 'unknown'}),
      candidate('owned', 'owned-old', 1, {agentId: 'someone'}), candidate('owned', 'owned-new', 2),
      candidate('bound', 'bound-old', 1), candidate('bound', 'bound-new', 2),
      candidate('new-config', 'config-old', 1), candidate('new-config', 'config-new', 2, {params: {...execution.params, model: 'different'}}),
      candidate('unknown-older', 'unknown-before', 1, {state: 'unknown'}), candidate('unknown-older', 'unknown-after', 2),
    ];
    const ids = bindingCandidates(rows.reverse(), 'remote-1', 'codex', [{...employee, executionId: 'bound-old'}], 'configured-model', 'repo').map(e => e.executionId);
    return ids;
  }, {execution, employee});
  expect(result).toEqual(['latest']);
});

test('executor selection requires grant and current availability; missing capability reports fail closed', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async node => {
    const {availableEmployeeExecutors} = await import('/src/features/workspace/employees.tsx');
    return [
      availableEmployeeExecutors(node),
      availableEmployeeExecutors({...node, granted: ['agent.codex']}),
      availableEmployeeExecutors({...node, capabilities: [{name: 'agent.codex', available: false}, {name: 'agent.claude', available: true}]}),
      availableEmployeeExecutors({...node, capabilities: undefined}),
      availableEmployeeExecutors({...node, granted: []}),
    ];
  }, nodes[0]);
  expect(result).toEqual([['codex', 'claude'], ['codex'], ['claude'], [], []]);
});

test('selecting an employee opens its existing console without sending or starting work', async ({page}) => {
  const {panel, posts} = await mount(page, [{...employee, executionId: execution.executionId}]);
  await panel.getByRole('combobox', {name: /^Virtual employees/}).selectOption(employee.agentId);
  await expect(panel.getByTestId('session-console')).toBeVisible();
  await expect(panel.getByTestId('session-console').getByRole('status')).toHaveText('succeeded');
  expect(posts).toEqual([]);
  await panel.getByRole('textbox', {name: 'Message to employee', exact: true}).fill('Explicit next turn');
  expect(posts).toEqual([]);
  await panel.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({path: '/agent/agents/send', body: {agentId: employee.agentId, text: 'Explicit next turn'}});
});

for (const nodeId of [undefined, '', '   ']) {
  test(`legacy definition without a usable node binding is read-only (${JSON.stringify(nodeId)})`, async ({page}) => {
    const legacy = {...employee, nodeId, executionId: execution.executionId};
    const {panel, posts} = await mount(page, [legacy]);
    await panel.getByRole('combobox', {name: /^Virtual employees/}).selectOption(legacy.agentId);
    await expect(panel.getByRole('textbox', {name: 'Message to employee', exact: true})).toBeDisabled();
    await expect(panel.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
    await expect(panel.getByRole('button', {name: 'Edit employee', exact: true})).toBeDisabled();
    await expect(panel.getByTestId('session-console')).toHaveCount(0);
    await expect(panel).not.toContainText('Create session on first message');
    expect(posts).toEqual([]);
    await panel.getByRole('button', {name: 'Refresh', exact: true}).click();
    await expect(panel.getByRole('button', {name: 'Refresh', exact: true})).toBeEnabled();
    await expect(panel.getByTestId('session-console')).toHaveCount(0);
    expect(posts).toEqual([]);
  });
}
