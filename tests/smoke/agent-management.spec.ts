import { test, expect } from '@playwright/test';

const node = {nodeId: '2', name: 'Laptop', platform: 'macos', runtimeVersion: '1', state: 'active', granted: ['agent.codex', 'unknown'], capabilities: [{name: 'agent.codex', available: true}, {name: 'agent.claude', available: true}, {name: 'unknown', available: true}, {name: 'unverified', available: true}], workdirs: [{id: 'repo', label: 'Repository'}]};
const employee = {agentId: '3', name: 'Engineer', title: 'Developer', nodeId: '2', executor: 'codex', model: 'configured', workdirBindingId: 'repo', roleDescription: 'Implement', config: {}, createdAt: 1};
const item = {id: '5', workspaceId: '4', title: 'Ship core', description: 'Core only', acceptance: 'Checks pass', status: 'open', version: 7};
const binding = {id: '6', nodeId: '2', capability: 'agent.codex', revoked: 0};
const note = {id: '7', workItemId: '5', kind: 'artifact', body: 'Fixed commit', artifactRef: 'commit:abc123'};
const link = {id: '8', executionId: '9', state: 'succeeded'};

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.evaluate(async () => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage('en');});
  page.on('dialog', d => d.accept());
});

test('device page pairs, limits grants, preserves unknown grants and reports pending revocation', async ({page}) => {
  const posts: {path: string; body: any}[] = [];
  await page.route('**/__manage/app/agent/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    if (body) posts.push({path, body});
    const data = path.endsWith('/nodes') ? [node] : path.endsWith('/pairing/approve') ? {pairingId: '1', deviceName: 'Laptop', platform: 'macos', runtimeVersion: '1', expiresAt: Date.now() + 60000} : path.endsWith('/revoke') ? {...node, state: 'revoked', deviceRevocation: 'pending'} : {...node, granted: body.capabilities};
    await route.fulfill({json: {code: 0, data}});
  });
  await page.evaluate(async () => {const {mountDevicePage} = await import('/src/test-harness/workspace-console.tsx'); mountDevicePage(`${location.origin}/__manage/app`);});
  const p = page.getByTestId('device-page');
  await p.getByLabel('Pairing code').fill('ABC123');
  await p.getByRole('button', {name: 'Approve pairing'}).click();
  await expect(p.getByText('Pairing approved. Waiting for device activation.')).toBeVisible();
  await p.getByRole('combobox', {name: /^Devices/}).selectOption('2');
  await expect(p.getByRole('checkbox', {name: /unverified/})).toBeDisabled();
  await p.getByRole('checkbox', {name: /agent.claude/}).check();
  await p.getByRole('button', {name: 'Save capabilities'}).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].body).toEqual({nodeId: '2', capabilities: ['agent.codex', 'unknown', 'agent.claude']});
  await p.getByRole('button', {name: 'Revoke device', exact: true}).click();
  await expect(p.getByText('Business access revoked; communication revocation is pending confirmation')).toBeVisible();
  await expect(p.getByRole('button', {name: 'Revoke device', exact: true})).toHaveCount(0);
  expect(posts[0].body).toEqual({pairingCode: 'ABC123'});
  expect(posts.every(p => !p.path.includes('executions'))).toBe(true);
});

for (const locale of ['en', 'zh-CN', 'vi']) test(`device page mobile and localized (${locale})`, async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/__manage/app/agent/nodes', r => r.fulfill({json: {code: 0, data: [node]}}));
  await page.evaluate(async language => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage(language); const {mountDevicePage} = await import('/src/test-harness/workspace-console.tsx'); mountDevicePage(`${location.origin}/__manage/app`);}, locale);
  const p = page.getByTestId('device-page');
  await p.getByRole('combobox').selectOption('2');
  await expect(p.getByRole('heading', {name: 'Laptop'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(p).not.toContainText('agentWorkspace.');
});

test('work item updates carry snapshot version and append artifact notes', async ({page}) => {
  const writes: {method: string; body: any}[] = [];
  await page.route('**/__manage/app/workspace/**', async route => {
    writes.push({method: route.request().method(), body: route.request().postDataJSON()});
    await route.fulfill({json: {code: 0, data: route.request().url().includes('work-note') ? {...note, id: '10'} : {...item, version: 8}}});
  });
  await page.evaluate(async ({item, note}) => {const {mountWorkItem} = await import('/src/test-harness/workspace-console.tsx'); mountWorkItem(`${location.origin}/__manage/app`, item, [note]);}, {item, note});
  const p = page.getByTestId('work-item-panel');
  await p.getByRole('button', {name: 'Edit work item'}).click();
  await p.getByLabel('Name', {exact: true}).fill('Updated core');
  await p.getByRole('button', {name: 'Save work item'}).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({method: 'PUT', body: {id: '5', version: 7, title: 'Updated core', acceptance: 'Checks pass'}});
  await p.getByRole('button', {name: 'Done', exact: true}).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).toEqual({id: '5', version: 7, status: 'done'});
  await p.getByLabel('Record type').selectOption('artifact');
  await p.getByLabel('Record content').fill('Build evidence');
  await p.getByLabel('Artifact reference', {exact: true}).fill('commit:def456');
  await p.getByRole('button', {name: 'Add record'}).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].body).toEqual({workItemId: '5', kind: 'artifact', body: 'Build evidence', artifactRef: 'commit:def456'});
});

async function assistantRoutes(page: import('@playwright/test').Page, send: (route: import('@playwright/test').Route) => Promise<void>) {
  await page.route('**/__manage/app/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/conversation/send')) return send(route);
    const data = path.endsWith('/personal') ? {available: true, claimed: true} : path.endsWith('/conversation/list') ? {items: [], nextAfterId: '0', hasMore: false} : path.endsWith('/agents') ? [employee] : path.endsWith('/nodes') ? [node] : path.endsWith('/workspace/list') ? [{id: '4', name: 'Team', archived: 0}] : path.endsWith('/work-item/list') ? [item] : path.endsWith('/agent-binding/list') ? [binding, {...binding, id: '60', nodeId: '99'}] : path.endsWith('/work-execution/list') ? [link] : path.endsWith('/work-note/list') ? [note] : [];
    await route.fulfill({json: {code: 0, data}});
  });
  await page.evaluate(async () => {const {mountAssistantPage} = await import('/src/test-harness/workspace-console.tsx'); mountAssistantPage(`${location.origin}/__manage/app`);});
}

test('assistant reload resends the identical persisted request after lost response and localizes receipts with target navigation', async ({page}) => {
  const bodies: any[] = [];
  await assistantRoutes(page, async route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    if (bodies.length === 1) return route.abort();
    await route.fulfill({json: {code: 0, data: {requestId: body.requestId, status: 'settled', messages: [{id: '11', requestId: body.requestId, role: 'user', text: body.text, kind: 'message', createdAt: 1}, {id: '12', requestId: body.requestId, role: 'assistant', text: 'Execution 9: running', kind: 'reply', createdAt: 2, result: {outcome: 'accepted', summary: 'Execution 9: running', state: 'running', reference: {executionId: '9', agentId: '3'}}}]}}});
  });
  const p = page.getByTestId('assistant-page');
  await p.getByRole('button', {name: 'Advanced explicit controls (optional)'}).click();
  await p.getByLabel('Explicit action').selectOption('send_employee');
  await p.getByRole('combobox', {name: /^Virtual employees/}).selectOption('3');
  await p.getByLabel('Goal or message').fill('Implement only core');
  await p.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect(p.getByRole('button', {name: 'Retry same request'})).toBeVisible();
  await expect(p.getByLabel('Goal or message')).toBeDisabled();
  await page.reload();
  await page.evaluate(async () => {const {mountAssistantPage} = await import('/src/test-harness/workspace-console.tsx'); mountAssistantPage(`${location.origin}/__manage/app`);});
  await expect(p.getByLabel('Goal or message')).toHaveValue('Implement only core');
  await expect(p.getByRole('button', {name: 'Back', exact: true})).toBeDisabled();
  expect(bodies).toHaveLength(1);
  await p.getByRole('button', {name: 'Retry same request'}).click();
  await expect(p.getByText('Accepted; not completed · Running', {exact: true})).toBeVisible();
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0].requestId).toHaveLength(36);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('privchat.web.assistant.pending.')))).toEqual([]);
  await expect(p).not.toContainText('Execution 9: running');
  await expect(p.getByText('Implement only core', {exact: true})).toBeVisible();
  await p.getByRole('button', {name: 'Open this execution in console'}).click();
  expect(await p.evaluate(el => el.parentElement?.dataset.reference)).toBe(JSON.stringify({executionId: '9', agentId: '3'}));
});

test('assistant workspace assign and review use version, matching binding and source link IDs', async ({page}) => {
  const bodies: any[] = [];
  await assistantRoutes(page, async route => {const body = route.request().postDataJSON(); bodies.push(body); await route.fulfill({json: {code: 0, data: {requestId: body.requestId, status: 'settled', messages: []}}});});
  const p = page.getByTestId('assistant-page');
  await p.getByRole('button', {name: 'Advanced explicit controls (optional)'}).click();
  await p.getByLabel('Explicit action').selectOption('assign');
  await p.getByRole('combobox', {name: /^Workspaces/}).selectOption('4');
  await p.getByRole('combobox', {name: /^Work items/}).selectOption('5');
  await p.getByRole('combobox', {name: /^Virtual employees/}).selectOption('3');
  await p.getByRole('combobox', {name: /^Authorized capability/}).selectOption('6');
  await expect(p.getByLabel('Authorized capability').getByRole('option')).toHaveCount(2);
  await p.getByLabel('Goal or message').fill('Implement core');
  await p.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].action).toEqual({kind: 'assign', context: {workspaceId: '4', workItemId: '5', workItemVersion: 7, agentId: '3', bindingId: '6'}});
  await p.getByLabel('Explicit action').selectOption('review');
  await p.getByLabel('Successful source work execution (link ID)').selectOption('8');
  await p.getByLabel('Fixed evidence and revision').fill('commit abc123, immutable build v1');
  await p.getByRole('checkbox', {name: /commit:abc123/}).check();
  await p.getByLabel('Goal or message').fill('Review only this evidence');
  await p.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].action).toEqual({kind: 'review', context: {workspaceId: '4', workItemId: '5', workItemVersion: 7, agentId: '3', bindingId: '6', workExecutionId: '8', evidenceNoteIds: ['7'], evidenceDescription: 'commit abc123, immutable build v1'}});
  expect(bodies[1]).not.toHaveProperty('sourceExecutionIds');
});

test('workflow assigns, snapshots source link and explicitly records a human review without accepting work', async ({page}) => {
  const posts: {path: string; body: any}[] = [];
  let reviewed = false, recorded = false;
  const review = () => ({noteId: '12', workItemId: '5', workItemVersion: 7, sourceWorkExecutionId: '8', sourceExecutionId: '9', evidenceNoteIds: ['7'], evidenceDescription: 'commit abc123', reviewerEmployeeId: '3', reviewerExecution: {id: '13', executionId: '14', state: 'succeeded'}, requestedBy: '1', createdAt: 1, conclusion: recorded ? 'passed' : null, conclusionBody: recorded ? 'Checked fixed evidence' : null});
  await page.route('**/__manage/app/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    let data: unknown = [];
    if (body) posts.push({path, body});
    if (path.endsWith('/agents')) data = [employee];
    if (path.endsWith('/work-execution/list')) data = [link];
    if (path.endsWith('/assign')) data = {id: '10', executionId: '11', state: 'accepted'};
    if (path.endsWith('/request-review')) {reviewed = true; data = review();}
    if (path.endsWith('/record-review')) {recorded = true; data = review();}
    if (path.endsWith('/review-list')) data = reviewed ? [review()] : [];
    await route.fulfill({json: {code: 0, data}});
  });
  await page.evaluate(async ({item, node, binding, note}) => {const {mountWorkflow} = await import('/src/test-harness/workspace-console.tsx'); mountWorkflow(`${location.origin}/__manage/app`, item, [node], [binding], [note]);}, {item, node, binding, note});
  const p = page.getByTestId('workflow-panel');
  await p.getByRole('combobox', {name: /^Virtual employees/}).selectOption('3');
  await p.getByRole('combobox', {name: /^Authorized capability/}).selectOption('6');
  await p.getByLabel('Work instructions', {exact: true}).fill('Implement core');
  await p.getByRole('button', {name: 'Assign to employee'}).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body).toMatchObject({workItemId: '5', version: 7, employeeId: '3', bindingId: '6'});
  expect(posts[0].body.requestId).toHaveLength(36);
  await p.getByLabel('Successful source work execution (link ID)').selectOption('8');
  await p.getByLabel('Fixed evidence and revision').fill('commit abc123');
  await p.getByRole('checkbox', {name: /commit:abc123/}).check();
  await p.getByRole('button', {name: 'Request employee review'}).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].body).toMatchObject({sourceWorkExecutionId: '8', evidenceNoteIds: ['7'], version: 7});
  expect(posts[1].body).not.toHaveProperty('executionId');
  await p.getByRole('combobox', {name: /^Record human conclusion/}).selectOption('12');
  await p.getByLabel('Review conclusion').selectOption('passed');
  await p.getByLabel('Conclusion rationale').fill('Checked fixed evidence');
  await p.getByRole('button', {name: 'Record human conclusion'}).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2].body).toMatchObject({reviewNoteId: '12', conclusion: 'passed', body: 'Checked fixed evidence'});
  expect(posts.some(p => p.path.includes('update-status'))).toBe(false);
});

test('assistant localizes every real agent state and retains pending domain requests', async ({page}) => {
  let sends = 0;
  const bodies: any[] = [];
  await assistantRoutes(page, async route => {
    const body = route.request().postDataJSON(); bodies.push(body); sends++;
    await route.fulfill({json: {code: 0, data: {requestId: body.requestId, status: sends === 1 ? 'pending' : 'settled', messages: ['accepted', 'dispatched', 'waiting_user', 'cancelling'].map((state, index) => ({id: String(20 + index), requestId: body.requestId, role: 'assistant', text: `Execution 9: ${state}`, kind: 'report', createdAt: 1, result: {outcome: 'accepted', summary: `Execution 9: ${state}`, state, reference: {executionId: '9'}}}))}}});
  });
  const p = page.getByTestId('assistant-page');
  await p.getByLabel('Goal or message').fill('Show capability help');
  await p.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect(p.getByRole('button', {name: 'Retry same request'})).toBeVisible();
  await expect(p.getByRole('button', {name: 'Back', exact: true})).toBeDisabled();
  await p.getByRole('button', {name: 'Retry same request'}).click();
  await expect(p.getByText('Accepted; not completed · Waiting for your confirmation in console')).toBeVisible();
  expect(bodies[0]).toEqual(bodies[1]);
  await page.evaluate(async () => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage('zh-CN');});
  await expect(p.getByText('已受理，尚未完成 · 已下发设备')).toBeVisible();
  await expect(p.getByText('已受理，尚未完成 · 等待你在操作台确认')).toBeVisible();
  await expect(p.getByText('已受理，尚未完成 · 已请求取消，等待设备确认')).toBeVisible();
  await expect(p).not.toContainText('Execution 9:');
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('assistant automatically reads authoritative reports without sending another action', async ({page}) => {
  let sends = 0, reports = 0;
  await assistantRoutes(page, async route => {sends++; await route.abort();});
  const p = page.getByTestId('assistant-page');
  await expect(p.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
  await p.getByLabel('Goal or message').fill('Only check reports');
  await expect(p.getByRole('button', {name: 'Send message', exact: true})).toBeEnabled();
  await page.route('**/__manage/app/assistant/conversation/list?**', async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('refresh')).toBe('true');
    reports++;
    await route.fulfill({json: {code: 0, data: {items: [{id: '100', requestId: 'prior-request', role: 'assistant', text: 'Execution 9: succeeded', kind: 'report', createdAt: 1, result: {outcome: 'completed', state: 'succeeded', summary: 'Execution 9: succeeded', reference: {executionId: '9'}}}], nextAfterId: '100', hasMore: false}}});
  });
  await expect(p.getByText('Request completed · Execution succeeded; acceptance still required', {exact: true})).toBeVisible({timeout: 10000});
  await expect(p).not.toContainText('Execution 9: succeeded');
  expect(reports).toBeGreaterThan(0); expect(sends).toBe(0);
});

test('assistant refreshes source work executions so a completed assignment becomes reviewable without reselecting the item', async ({page}) => {
  let reads = 0, sends = 0;
  await assistantRoutes(page, async route => {sends++; await route.abort();});
  await page.route('**/__manage/app/workspace/work-execution/list?**', async route => {
    reads++;
    await route.fulfill({json: {code: 0, data: [{...link, state: reads === 1 ? 'running' : 'succeeded'}]}});
  });
  const p = page.getByTestId('assistant-page');
  await p.getByRole('button', {name: 'Advanced explicit controls (optional)'}).click();
  await p.getByLabel('Explicit action').selectOption('review');
  await p.getByRole('combobox', {name: /^Workspaces/}).selectOption('4');
  await p.getByRole('combobox', {name: /^Work items/}).selectOption('5');
  await expect.poll(() => reads).toBeGreaterThan(0);
  const source = p.getByLabel('Successful source work execution (link ID)');
  await expect(source.getByRole('option', {name: '8 · 9 · succeeded', exact: true})).toBeAttached({timeout: 10000});
  await source.selectOption('8');
  expect(reads).toBeGreaterThan(1); expect(sends).toBe(0);
});

const naturalCommands = [
  '让「开发」做登录修复',
  '让「开发」处理「登录修复」任务：修复验证码',
  '让「评审」评审「登录修复」任务，证据：commit abc123',
  '查看「开发」的进度',
  '停止「开发」的任务',
];

for (const command of naturalCommands) {
  test(`natural Chinese command sends no action: ${command}`, async ({page}) => {
    const bodies: any[] = [];
    const detail = '已处理中文指令；评审证据 commit abc123。\n尚未验收或发布。';
    await assistantRoutes(page, async route => {
      const body = route.request().postDataJSON(); bodies.push(body);
      await route.fulfill({json: {code: 0, data: {requestId: body.requestId, status: 'settled', messages: [
        {id: '201', requestId: body.requestId, role: 'user', text: body.text, kind: 'message', createdAt: 1},
        {id: '202', requestId: body.requestId, role: 'assistant', text: 'Execution 9: running', kind: 'reply', createdAt: 2, result: {replyKind: 'task', outcome: 'accepted', summary: 'Execution 9: running', state: 'running', detail, reference: {executionId: '9'}}},
      ]}}});
    });
    const p = page.getByTestId('assistant-page');
    await expect(p.getByRole('combobox')).toHaveCount(0);
    await p.getByLabel('Goal or message').fill(command);
    await p.getByRole('button', {name: 'Send message', exact: true}).click();
    await expect(p.getByText(command, {exact: true})).toBeVisible();
    await expect(p.getByText(detail, {exact: true})).toBeVisible();
    await expect(p.getByText('Employee-provided output, not a verified assistant audit or acceptance.', {exact: true})).toBeVisible();
    await expect(p.getByTestId('assistant-task-status')).toHaveText('Accepted; not completed · Running');
    await expect(p).not.toContainText('Execution 9: running');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({requestId: expect.any(String), text: command});
    expect(bodies[0].requestId).toHaveLength(36);
  });
}

test('natural clarification/help keep text; legacy tasks without replyKind keep localized state and safe detail', async ({page}) => {
  const bodies: any[] = [];
  const clarification = '有两位名为「开发」的员工，请明确员工名称。';
  const help = '支持按名称指派、评审、查看进度和停止任务。';
  const legacy = '请补充要处理的任务名称。';
  const literal = '<img src=x onerror="window.__unsafe=true">';
  const replies = [
    {text: clarification, result: {outcome: 'completed', summary: clarification, replyKind: 'clarification', state: 'succeeded', detail: null}},
    {text: '', result: {outcome: 'completed', summary: help, replyKind: 'help', state: 'succeeded', detail: literal}},
    {text: legacy},
    {text: '未来回复类型仍可阅读', result: {outcome: 'completed', summary: '未来回复类型仍可阅读', replyKind: 'future', detail: {internal: 'must not stringify'}}},
    {text: 'Raw legacy state-only reply', result: {outcome: 'accepted', summary: 'Raw legacy state-only summary', state: 'running', detail: '旧服务员工输出：正在修复登录。'}},
    {text: 'Raw legacy reference-only reply', result: {outcome: 'completed', summary: 'Raw legacy reference-only summary', reference: {executionId: '9'}, detail: '旧服务员工输出：评审发现缺少测试。'}},
    {text: 'Raw legacy nullable-kind reply', result: {outcome: 'completed', summary: 'Raw legacy nullable-kind summary', replyKind: null, state: 'succeeded', reference: {executionId: '9'}, detail: '旧服务员工输出：等待人工验收。'}},
  ];
  await assistantRoutes(page, async route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    const reply = replies[bodies.length - 1];
    await route.fulfill({json: {code: 0, data: {requestId: body.requestId, status: 'settled', messages: [{id: String(300 + bodies.length), requestId: body.requestId, role: 'assistant', kind: 'reply', createdAt: 1, ...reply}]}}});
  });
  const p = page.getByTestId('assistant-page');
  for (const [index, command] of ['让「开发」做登录修复', '帮助', '处理任务', '查看进度', '查看「开发」的进度', '查看「评审」的进度', '查看「测试」的进度'].entries()) {
    await p.getByLabel('Goal or message').fill(command);
    await p.getByRole('button', {name: 'Send message', exact: true}).click();
    await expect.poll(() => bodies.length).toBe(index + 1);
    await expect(p.getByLabel('Goal or message')).toHaveValue('');
  }
  for (const text of [clarification, help, legacy, literal, '未来回复类型仍可阅读']) {
    await expect(p.getByText(text, {exact: true})).toHaveCount(1);
    await expect(p.getByText(text, {exact: true})).toBeVisible();
  }
  for (const text of [clarification, help]) {
    const reply = p.getByTestId('assistant-message').filter({has: page.getByText(text, {exact: true})});
    await expect(reply.getByTestId('assistant-task-status')).toHaveCount(0);
    await expect(reply).not.toContainText(/Accepted|Request completed|Execution succeeded/);
    await expect(reply.getByText('Employee-provided output, not a verified assistant audit or acceptance.', {exact: true})).toHaveCount(0);
  }
  for (const [detail, status] of [
    ['旧服务员工输出：正在修复登录。', 'Accepted; not completed · Running'],
    ['旧服务员工输出：评审发现缺少测试。', 'Request completed'],
    ['旧服务员工输出：等待人工验收。', 'Request completed · Execution succeeded; acceptance still required'],
  ]) {
    const reply = p.getByTestId('assistant-message').filter({has: page.getByText(detail!, {exact: true})});
    await expect(reply.getByText(detail!, {exact: true})).toBeVisible();
    await expect(reply.getByTestId('assistant-task-status')).toHaveText(status!);
    await expect(reply.getByText('Employee-provided output, not a verified assistant audit or acceptance.', {exact: true})).toBeVisible();
  }
  await expect(p).not.toContainText('Raw legacy');
  await expect(p.locator('img')).toHaveCount(0);
  await expect(p).not.toContainText('must not stringify');
  for (const body of bodies) expect(Object.keys(body).sort()).toEqual(['requestId', 'text']);
  expect(new Set(bodies.map(body => body.requestId)).size).toBe(7);
});

test('natural retries preserve the identical Chinese body and key across ambiguous errors and pending receipt', async ({page}) => {
  const bodies: any[] = [];
  await assistantRoutes(page, async route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    if (bodies.length === 1) return route.abort();
    if (bodies.length === 2) return route.fulfill({status: 500, body: 'response lost'});
    if (bodies.length === 3) return route.fulfill({json: {code: 4, message: 'BUSY'}});
    await route.fulfill({json: {code: 0, data: {requestId: body.requestId, status: bodies.length === 4 ? 'pending' : 'settled', messages: [{id: '401', requestId: body.requestId, role: 'assistant', text: '正在查询', kind: 'reply', createdAt: 1, result: {replyKind: 'task', summary: '正在查询', outcome: 'accepted', state: 'running', detail: '开发正在修复登录验证码。'}}]}}});
  });
  const p = page.getByTestId('assistant-page');
  const input = p.getByLabel('Goal or message');
  await input.fill('查看「开发」的进度');
  await p.getByRole('button', {name: 'Send message', exact: true}).click();
  for (let attempt = 1; attempt <= 4; attempt++) {
    await expect(p.getByRole('button', {name: 'Retry same request'})).toBeEnabled();
    await expect(input).toBeDisabled();
    await expect(p.getByRole('button', {name: 'Advanced explicit controls (optional)'})).toBeDisabled();
    await expect(p.getByRole('button', {name: 'Back', exact: true})).toBeDisabled();
    await p.getByRole('button', {name: 'Retry same request'}).click();
    await expect.poll(() => bodies.length).toBe(attempt + 1);
  }
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('');
  await expect(p.getByText('开发正在修复登录验证码。', {exact: true})).toHaveCount(1);
  for (const body of bodies) expect(body).toEqual(bodies[0]);
  expect(bodies[0]).toEqual({requestId: expect.any(String), text: '查看「开发」的进度'});
});

test('closing advanced mode ignores stale explicit target validation and sends natural text', async ({page}) => {
  const bodies: any[] = [];
  await assistantRoutes(page, async route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    await route.fulfill({json: {code: 0, data: {requestId: body.requestId, status: 'settled', messages: []}}});
  });
  const p = page.getByTestId('assistant-page');
  const toggle = p.getByRole('button', {name: 'Advanced explicit controls (optional)'});
  await toggle.click();
  await p.getByLabel('Explicit action').selectOption('assign');
  await p.getByLabel('Goal or message').fill('让「开发」做登录修复');
  await expect(p.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await p.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).not.toHaveProperty('action');
});

test('polled task review report displays employee-provided final detail without another send', async ({page}) => {
  let sends = 0;
  await assistantRoutes(page, async route => {sends++; await route.abort();});
  const p = page.getByTestId('assistant-page');
  await expect(p.getByLabel('Goal or message')).toBeEnabled();
  const detail = '评审报告：commit abc123\n发现验证码超时边界未覆盖，请补充测试。\n此评审不代表验收或发布。';
  await page.route('**/__manage/app/assistant/conversation/list?**', async route => {
    await route.fulfill({json: {code: 0, data: {items: [{id: '501', requestId: 'earlier-review', role: 'assistant', kind: 'report', text: 'Execution 9: succeeded', createdAt: 1, result: {replyKind: 'task', outcome: 'completed', summary: 'Execution 9: succeeded', state: 'succeeded', detail, reference: {workspaceId: '4', workItemId: '5', executionId: '9'}}}], nextAfterId: '501', hasMore: false}}});
  });
  await expect(p.getByText(detail, {exact: true})).toBeVisible({timeout: 10000});
  await expect(p.getByText('Employee-provided output, not a verified assistant audit or acceptance.', {exact: true})).toBeVisible();
  await expect(p.getByTestId('assistant-task-status')).toHaveText('Request completed · Execution succeeded; acceptance still required');
  await expect(p).not.toContainText('Execution 9: succeeded');
  await p.getByRole('button', {name: 'Open this execution in console'}).click();
  expect(await p.evaluate(el => el.parentElement?.dataset.reference)).toBe(JSON.stringify({workspaceId: '4', workItemId: '5', executionId: '9'}));
  expect(sends).toBe(0);
});

for (const response of ['pending', 'unknown', 'mismatched', 'missing-messages']) {
  test(`assistant reload preserves review snapshot after ${response} receipt without relying on target forms`, async ({page}) => {
    const bodies: any[] = [];
    await assistantRoutes(page, async route => {
      const body = route.request().postDataJSON(); bodies.push(body);
      const data = bodies.length > 1 ? {requestId: body.requestId, status: 'settled', messages: []}
        : {requestId: response === 'mismatched' ? 'another-request' : body.requestId,
          status: ['pending', 'unknown'].includes(response) ? response : 'settled',
          ...(response === 'missing-messages' ? {} : {messages: []})};
      await route.fulfill({json: {code: 0, data}});
    });
    const p = page.getByTestId('assistant-page');
    await p.getByRole('button', {name: 'Advanced explicit controls (optional)'}).click();
    await p.getByLabel('Explicit action').selectOption('review');
    await p.getByRole('combobox', {name: /^Workspaces/}).selectOption('4');
    await p.getByRole('combobox', {name: /^Work items/}).selectOption('5');
    await p.getByRole('combobox', {name: /^Virtual employees/}).selectOption('3');
    await p.getByRole('combobox', {name: /^Authorized capability/}).selectOption('6');
    await p.getByLabel('Successful source work execution (link ID)').selectOption('8');
    await p.getByLabel('Fixed evidence and revision').fill('immutable commit abc123');
    await p.getByRole('checkbox', {name: /commit:abc123/}).check();
    await p.getByLabel('Goal or message').fill('Review original snapshot');
    await p.getByRole('button', {name: 'Send message', exact: true}).click();
    await expect(p.getByRole('button', {name: 'Retry same request'})).toBeVisible();
    await page.reload();
    // Target snapshots may be gone or changed; recovery must use only the saved request.
    await page.route('**/__manage/app/workspace/**', route => route.fulfill({json: {code: 0, data: []}}));
    await page.evaluate(async () => {const {mountAssistantPage} = await import('/src/test-harness/workspace-console.tsx'); mountAssistantPage(`${location.origin}/__manage/app`);});
    await expect(p.getByLabel('Goal or message')).toHaveValue('Review original snapshot');
    await expect(p.getByRole('button', {name: 'Back', exact: true})).toBeDisabled();
    expect(bodies).toHaveLength(1); // No automatic replay or new execution on reload.
    await p.getByRole('button', {name: 'Retry same request'}).click();
    await expect(p.getByRole('button', {name: 'Retry same request'})).toHaveCount(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[1].action.context).toEqual({workspaceId: '4', workItemId: '5', workItemVersion: 7, agentId: '3', bindingId: '6', workExecutionId: '8', evidenceNoteIds: ['7'], evidenceDescription: 'immutable commit abc123'});
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('privchat.web.assistant.pending.')))).toEqual([]);
  });
}
