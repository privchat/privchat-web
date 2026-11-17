import { test, expect, type Page } from '@playwright/test';

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

test('pairing keeps the code and claims the assistant only after explicit confirmation', async ({page}) => {
  let claimed = false;
  const approvals: string[] = [];
  await page.route('**/__manage/app/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/assistant/personal/claim')) {
      expect(route.request().postDataJSON()).toEqual({confirmed: true});
      claimed = true;
      return route.fulfill({json: {code: 0, data: {assistantUid: '1'}}});
    }
    if (path.endsWith('/pairing/approve')) {
      approvals.push(route.request().postDataJSON().pairingCode);
      if (!claimed) return route.fulfill({status: 403, json: {code: 10200, message: 'AGENT_ASSISTANT_NOT_CLAIMED'}});
      return route.fulfill({json: {code: 0, data: {pairingId: '1', deviceName: 'Laptop', expiresAt: Date.now() + 60000}}});
    }
    return route.fulfill({json: {code: 0, data: []}});
  });
  await page.evaluate(async () => {const {mountDevicePage} = await import('/src/test-harness/workspace-console.tsx'); mountDevicePage(`${location.origin}/__manage/app`);});
  await page.getByRole('button', {name: 'Add device'}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Pairing code').fill('ABC123');
  await dialog.getByRole('button', {name: 'Verify device'}).click();
  const action = dialog.getByRole('button', {name: 'Claim assistant and pair'});
  await expect(action).toBeVisible();
  expect(claimed).toBe(false);
  await expect(dialog.getByLabel('Pairing code')).toHaveValue('ABC123');
  await action.click();
  await expect(dialog.getByText('Pairing approved. Waiting for device activation.')).toBeVisible();
  expect(approvals).toEqual(['ABC123', 'ABC123']);
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
  await p.getByRole('button', {name: 'Add device'}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Pairing code').fill('ABC123');
  await dialog.getByRole('button', {name: 'Verify device'}).click();
  await expect(dialog.getByText('Pairing approved. Waiting for device activation.')).toBeVisible();
  await dialog.getByRole('button', {name: 'Cancel'}).click();
  await p.getByRole('row', {name: /Laptop/}).click();
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

test('a device reporting Qoder can be granted agent.qoder and is not treated as an unknown capability', async ({page}) => {
  const qoderNode = {...node, granted: [], capabilities: [{name: 'agent.qoder', available: true, version: 'qoder-cli 1.1.79'}, {name: 'agent.codex', available: false, reason: 'executor_not_logged_in'}, {name: 'unknown', available: true}]};
  const posts: {path: string; body: any}[] = [];
  await page.route('**/__manage/app/agent/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    if (body) posts.push({path, body});
    const data = path.endsWith('/nodes') ? [qoderNode] : {...qoderNode, granted: body.capabilities};
    await route.fulfill({json: {code: 0, data}});
  });
  await page.evaluate(async () => {const {mountDevicePage} = await import('/src/test-harness/workspace-console.tsx'); mountDevicePage(`${location.origin}/__manage/app`);});
  const p = page.getByTestId('device-page');
  await p.getByRole('row', {name: /Laptop/}).click();
  await expect(p.getByRole('checkbox', {name: /agent\.qoder/})).toBeEnabled();
  await expect(p.getByRole('checkbox', {name: /unknown/})).toBeDisabled();
  await p.getByRole('checkbox', {name: /agent\.qoder/}).check();
  await p.getByRole('button', {name: 'Save capabilities'}).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body).toEqual({nodeId: '2', capabilities: ['agent.qoder']});
});

for (const locale of ['en', 'zh-CN', 'vi']) test(`device page mobile and localized (${locale})`, async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/__manage/app/agent/nodes', r => r.fulfill({json: {code: 0, data: [node]}}));
  await page.evaluate(async language => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage(language); const {mountDevicePage} = await import('/src/test-harness/workspace-console.tsx'); mountDevicePage(`${location.origin}/__manage/app`);}, locale);
  const p = page.getByTestId('device-page');
  await p.getByRole('row', {name: /Laptop/}).click();
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
    if (path.endsWith('/employee/page')) data = {items: [{id: 'ref-3', workspaceId: '4', employeeId: employee.agentId, name: employee.name, nodeId: employee.nodeId, capability: 'agent.codex', workdirBindingId: employee.workdirBindingId, available: true, projectTargetIds: []}], nextCursor: null, hasMore: false};
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
  await p.getByLabel('Delivered result to review').selectOption('8');
  await p.getByLabel('Fixed evidence and revision').fill('commit abc123');
  await p.getByRole('checkbox', {name: /commit:abc123/}).check();
  await p.getByRole('button', {name: 'Request employee review'}).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].body).toMatchObject({sourceWorkExecutionId: '8', evidenceNoteIds: ['7'], version: 7});
  expect(posts[1].body).not.toHaveProperty('executionId');
  await p.getByRole('combobox', {name: /^Record human conclusion/}).selectOption('12');
  await expect(p.locator('article')).toContainText('Delivered result to review: 8 · v7');
  await expect(p.getByLabel('Review conclusion')).toHaveValue('');
  await p.getByLabel('Conclusion rationale').fill('Checked fixed evidence');
  await expect(p.getByRole('button', {name: 'Record human conclusion'})).toBeDisabled();
  await p.getByLabel('Review conclusion').selectOption('passed');
  await p.getByLabel('Conclusion rationale').fill('Checked fixed evidence');
  await p.getByRole('button', {name: 'Record human conclusion'}).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2].body).toMatchObject({reviewNoteId: '12', conclusion: 'passed', body: 'Checked fixed evidence'});
  expect(posts.some(p => p.path.includes('update-status'))).toBe(false);
});


test('personal assistant opens an SDK Direct chat without REST conversation traffic or a dedicated composer', async ({page}) => {
  const requests: string[] = [];
  await page.route('**/__manage/app/**', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path.endsWith('/personal/open-chat')) {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({});
      return route.fulfill({json: {code: 0, data: {channelId: '9223372036854775000', assistantUid: '9223372036854775001', name: 'Personal Xiaowei'}}});
    }
    expect(path.endsWith('/assistant/personal')).toBe(true);
    await route.fulfill({json: {code: 0, data: {available: true, claimed: true}}});
  });
  await page.evaluate(async () => {const {mountAssistantPage} = await import('/src/test-harness/workspace-console.tsx'); mountAssistantPage(location.origin + '/__manage/app');});
  const p = page.getByTestId('assistant-page');
  await expect.poll(() => p.evaluate(el => el.parentElement?.dataset.chat)).toBe(JSON.stringify({channelId: '9223372036854775000', channelType: 1, peer: {uid: '9223372036854775001', name: 'Personal Xiaowei'}}));
  expect(await p.evaluate(el => el.parentElement?.dataset.sdkLoaded)).toBe('true');
  await expect(p.locator('textarea, input, select')).toHaveCount(0);
  expect(requests.some(path => path.includes('/conversation/'))).toBe(false);
});

test('unclaimed assistant requires confirmation then opens the ordinary Direct', async ({page}) => {
  const writes: string[] = [];
  await page.route('**/__manage/app/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') writes.push(path);
    const data = path.endsWith('/personal/claim') ? {assistantUid: '73', name: 'Xiaowei'}
      : path.endsWith('/personal/open-chat') ? {channelId: '84', assistantUid: '73', name: 'Xiaowei'}
      : {available: true, claimed: false};
    if (path.endsWith('/personal/claim')) expect(route.request().postDataJSON()).toEqual({confirmed: true});
    await route.fulfill({json: {code: 0, data}});
  });
  await page.evaluate(async () => {const {mountAssistantPage} = await import('/src/test-harness/workspace-console.tsx'); mountAssistantPage(location.origin + '/__manage/app');});
  const p = page.getByTestId('assistant-page');
  await expect(p.getByRole('button', {name: 'Claim assistant', exact: true})).toBeVisible();
  expect(writes).toEqual([]);
  await p.getByRole('button', {name: 'Claim assistant', exact: true}).click();
  await expect.poll(() => p.evaluate(el => el.parentElement?.dataset.chat)).toBe(JSON.stringify({channelId: '84', channelType: 1, peer: {uid: '73', name: 'Xiaowei'}}));
  expect(writes).toEqual(['/__manage/app/assistant/personal/claim', '/__manage/app/assistant/personal/open-chat']);
});

test('blocked assignment receipt keeps original request and never reports success or opens execution', async ({page}) => {
  const assigns: any[] = [];
  await page.route('**/__manage/app/**', async route => {
    const path = new URL(route.request().url()).pathname; let data: unknown = [];
    if (path.endsWith('/employee/page')) data = {items: [{id: 'ref-3', workspaceId: '4', employeeId: '3', name: 'Engineer', nodeId: '2', capability: 'agent.codex', workdirBindingId: 'repo', available: true, projectTargetIds: []}], nextCursor: null, hasMore: false};
    if (path.endsWith('/assign')) {assigns.push(route.request().postDataJSON()); data = {id: 'held', executionId: 'accepted-held', state: 'accepted', deliveryBlockedReason: 'AUTHORITY_CHANGED_PRIVATE_DETAIL'};}
    await route.fulfill({json: {code: 0, data}});
  });
  await page.evaluate(async ({item, node, binding}) => {const {mountWorkflow} = await import('/src/test-harness/workspace-console.tsx'); mountWorkflow(`${location.origin}/__manage/app`, item, [node], [binding], []);}, {item, node, binding});
  const panel = page.getByTestId('workflow-panel');
  await panel.getByRole('combobox', {name: /^Virtual employees/}).selectOption('3'); await panel.getByRole('combobox', {name: /^Authorized capability/}).selectOption('6');
  await panel.getByLabel('Work instructions', {exact: true}).fill('Keep original identity'); await panel.getByRole('button', {name: 'Assign to employee'}).click();
  await expect(panel.getByTestId('delivery-blocked')).toContainText('execution delivery is blocked'); await expect(panel.getByTestId('delivery-blocked')).not.toContainText('AUTHORITY_CHANGED_PRIVATE_DETAIL');
  await expect(panel.getByRole('status')).toHaveCount(0); expect(await panel.evaluate(el => el.parentElement?.dataset.execution ?? '')).toBe('');
  await panel.getByRole('button', {name: 'Retry same request'}).click(); await expect.poll(() => assigns.length).toBe(2); expect(assigns[0]).toEqual(assigns[1]);
});

const projectNode = {...node, workdirs: [{id: 'repo', label: 'Repository'}, {id: 'docs', label: 'Docs'}]};
const linked = (employeeId: string, name: string, workdirBindingId: string, extras = {}) =>
  ({id: `ref-${employeeId}`, workspaceId: '4', employeeId, name, nodeId: '2', capability: 'agent.codex', workdirBindingId, available: true, projectIds: ['p'], ...extras});

/** The task belongs to a project, so my own directory binding decides who may develop and who may only review (§20.3/§20.5). */
async function projectWorkflow(page: Page, {directories, reviewerEmployeeId, rows, bindings = [binding], links = [] as object[]}: {
  directories: {workdirBindingId: string; label: string; access: string}[]; reviewerEmployeeId: string | null;
  rows: ReturnType<typeof linked>[]; bindings?: object[]; links?: object[];
}) {
  const posts: {path: string; body: any}[] = [];
  let granted = bindings as {id: string; nodeId: string; capability: string; revoked: number}[];
  let associated = rows;
  await page.route('**/__manage/app/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__manage/app', '');
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    if (body) posts.push({path, body});
    let data: unknown = [];
    if (path === '/workspace/project/get/p') data = {id: 'p', workspaceId: '4', name: 'Core', archived: 0, version: 3, description: '', manageable: true, roundEnd: '',
      bindings: [{id: 'pb', projectId: 'p', userId: 'me', mine: true, nodeId: '2', nodeName: 'Laptop', directories, notes: '', reviewerEmployeeId, version: 1}]};
    if (path === '/workspace/employee/page') data = {items: associated, nextCursor: null, hasMore: false};
    if (path === '/agent/nodes') data = [projectNode];
    if (path === '/workspace/agent-binding/list') data = granted;
    if (path === '/workspace/agent-binding/create') {
      granted = [...granted, {id: 'new-b', nodeId: body.nodeId, capability: body.capability, revoked: 0}];
      associated = associated.map(row => ({...row, available: true, unavailableReason: null}));
      data = granted.at(-1);
    }
    if (path === '/workspace/work-execution/list') data = links;
    if (path === '/workspace/work-execution/assign') data = {id: '10', executionId: '11', state: 'accepted'};
    if (path === '/workspace/work-note/request-review') data = {noteId: '12', workItemId: '5', workItemVersion: 7, sourceWorkExecutionId: '8', sourceExecutionId: '9', evidenceNoteIds: [], evidenceDescription: 'commit abc123', reviewerEmployeeId: body.reviewerEmployeeId, reviewerExecution: {id: '13', executionId: '14', state: 'accepted'}, requestedBy: '1', createdAt: 1, conclusion: null, conclusionBody: null};
    await route.fulfill({json: {code: 0, data}});
  });
  await page.evaluate(async ({item, node, bindings}) => {
    const {mountWorkflow} = await import('/src/test-harness/workspace-console.tsx');
    mountWorkflow(`${location.origin}/__manage/app`, item, [node], bindings, []);
  }, {item: {...item, projectId: 'p'}, node: projectNode, bindings});
  return posts;
}

test('a read-only start directory allows review but never development, and no employee reviews its own delivery', async ({page}) => {
  const posts = await projectWorkflow(page, {
    directories: [{workdirBindingId: 'repo', label: 'Repository', access: 'read'}, {workdirBindingId: 'docs', label: 'Docs', access: 'read'}],
    reviewerEmployeeId: '4',
    rows: [linked('3', 'Engineer', 'repo'), linked('4', 'Reviewer', 'docs')],
    links: [{id: '8', executionId: '9', state: 'succeeded', employeeId: '3', projectBindingId: 'pb', createdAt: 1}],
  });
  const p = page.getByTestId('workflow-panel'), developer = p.getByRole('combobox').first();
  await expect(developer.getByRole('option', {name: 'Engineer · Codex · review only', exact: true})).toHaveCount(1);
  await developer.selectOption('3');
  await p.getByLabel('Work instructions', {exact: true}).fill('Implement core');
  await expect(p.getByRole('button', {name: 'Assign to employee'})).toBeDisabled();
  await p.getByLabel('Delivered result to review').selectOption('8');
  await p.getByLabel('Fixed evidence and revision').fill('commit abc123');
  await expect(p.getByRole('button', {name: 'Request employee review'})).toBeDisabled();
  await developer.selectOption('4');
  await expect(p.getByRole('button', {name: 'Request employee review'})).toBeEnabled();
  await p.getByRole('button', {name: 'Request employee review'}).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].path).toBe('/workspace/work-note/request-review');
  expect(posts[0].body).toMatchObject({sourceWorkExecutionId: '8', reviewerEmployeeId: '4', reviewerBindingId: '6'});
  expect(posts.some(post => post.path.endsWith('/assign'))).toBe(false);
});

test('assignment defaults to automatic review by the binding reviewer and carries the chosen correction rounds', async ({page}) => {
  const posts = await projectWorkflow(page, {
    directories: [{workdirBindingId: 'repo', label: 'Repository', access: 'write'}],
    reviewerEmployeeId: '4',
    rows: [linked('3', 'Engineer', 'repo'), linked('4', 'Reviewer', 'repo')],
  });
  const p = page.getByTestId('workflow-panel'), auto = p.getByTestId('auto-review');
  await p.getByRole('combobox').first().selectOption('3');
  await expect(auto.getByRole('checkbox')).toBeChecked();
  await expect(auto).toContainText('Reviewed by Reviewer after delivery');
  await p.getByLabel('Work instructions', {exact: true}).fill('Implement core');
  await p.getByRole('button', {name: 'Assign to employee'}).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].body).toMatchObject({employeeId: '3', bindingId: '6', autoReview: true, correctionLimit: null});
  await expect(p.getByLabel('Automatic correction rounds')).toBeHidden();
  await auto.getByText('Advanced settings').click();
  await p.getByLabel('Automatic correction rounds').selectOption('3');
  await p.getByRole('button', {name: 'Assign to employee'}).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].body.correctionLimit).toBe(3);
  await auto.getByRole('checkbox').uncheck();
  await expect(p.getByLabel('Automatic correction rounds')).toHaveCount(0);
  await p.getByRole('button', {name: 'Assign to employee'}).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2].body.autoReview).toBe(false);
  expect(posts[2].body).not.toHaveProperty('correctionLimit');
});

test('a missing workspace authorization is granted in place before the assignment', async ({page}) => {
  const posts = await projectWorkflow(page, {
    directories: [{workdirBindingId: 'repo', label: 'Repository', access: 'write'}],
    reviewerEmployeeId: null,
    rows: [linked('3', 'Engineer', 'repo', {available: false, unavailableReason: 'agent_capability_not_granted'})],
    bindings: [],
  });
  const p = page.getByTestId('workflow-panel'), grant = p.getByTestId('grant-binding');
  await p.getByRole('combobox').first().selectOption('3');
  await expect(grant).toContainText('This workspace is not yet authorized to use this device.');
  await expect(grant).toContainText('Will authorize this workspace to use Codex on Laptop');
  await p.getByLabel('Work instructions', {exact: true}).fill('Implement core');
  await expect(p.getByRole('button', {name: 'Assign to employee'})).toBeDisabled();
  await grant.getByRole('button', {name: 'Authorize this workspace to use this device'}).click();
  await expect.poll(() => posts.filter(post => post.path === '/workspace/agent-binding/create').length).toBe(1);
  expect(posts[0].body).toEqual({workspaceId: '4', nodeId: '2', capability: 'agent.codex'});
  await expect(p.getByTestId('grant-binding')).toHaveCount(0);
  await expect(p.getByRole('button', {name: 'Assign to employee'})).toBeEnabled();
  await p.getByRole('button', {name: 'Assign to employee'}).click();
  await expect.poll(() => posts.filter(post => post.path.endsWith('/assign')).length).toBe(1);
  expect(posts.at(-1)!.body).toMatchObject({employeeId: '3', bindingId: 'new-b', autoReview: false});
});
