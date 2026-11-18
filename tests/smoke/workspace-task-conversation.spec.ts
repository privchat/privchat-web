import { expect, test, type Page } from '@playwright/test';

const path = '#/workspace/space/w/item/2';
const developer = {kind: 'turn', id: 't7', at: 2, role: 'developer', employeeId: '12', workExecutionId: '7', state: 'running'};
const request = {kind: 'requirement', id: 'a7', at: 1, text: 'Recover after reconnect'};
const review = {kind: 'cycle', id: 'c1', at: 3, state: 'recommendation_passed'};

async function fixture(page: Page, {entries = [] as object[], owner = 'test-owner', loseSend = false, verifyUnknown = false, runs = undefined as object[] | undefined, reviewError = false, reviews = [] as object[]} = {}) {
  const writes: {path: string; body: Record<string, unknown>}[] = [];
  let timeline = entries;
  let state = 'open';
  let version = 2;
  let reads = 0;
  await page.goto('/');
  await page.route('**/__task/app/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/__task/app', '');
    let data: unknown = [];
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON();
      writes.push({path, body});
      if (path.endsWith('/send')) {
        if (loseSend && writes.length === 1) return route.abort();
        if (verifyUnknown && writes.length === 1) return route.fulfill({json: {code: 10200, message: 'AGENT_PREVIOUS_RESULT_UNKNOWN'}});
        timeline = [...timeline, {kind: 'requirement', id: 'i9', at: 4, text: body.text, delivery: 'pending'}];
      }
      if (path.endsWith('/pause')) timeline = [...timeline, {kind: 'pause', id: 'p1', at: 4}];
      if (path.endsWith('/update-status')) state = body.status;
      data = true;
    }
    if (path.endsWith('/work-instruction/timeline')) data = timeline;
    if (path.endsWith('/work-execution/list') && timeline.some(e => 'workExecutionId' in e)) data = [{id: '7', executionId: '77', state: (timeline.find(e => 'workExecutionId' in e) as typeof developer).state}];
    if (path.endsWith('/work-execution/list') && runs) data = runs;
    if (path.endsWith('/work-note/review-list')) {
      if (reviewError) return route.abort();
      data = reviews;
    }
    if (path.endsWith('/workspace/get/w')) data = {id: 'w', name: 'Team', archived: 0, myRole: 'owner'};
    if (path.endsWith('/work-item/get/2')) {
      reads++;
      data = {id: '2', workspaceId: 'w', title: 'Reconnect task', description: '', createdBy: owner, version, status: state};
    }
    if (path.endsWith('/employee/list')) data = [{employeeId: '12', name: 'Ada'}];
    if (path.endsWith('/employee/page')) data = {items: [], hasMore: false, nextCursor: null};
    if (path.endsWith('/sessions/records')) data = {items: [{seq: 1, executionId: '77', eventId: '1', protocolVersion: 1, kind: 'output', payload: {items: [
      {id: 'weey-final-77', kind: 'assistant_text', text: '**Reconnect verified**\n\n- Queue recovered\n\n![track](https://example.org/tracker.png)'},
      {id: 'private-analysis', kind: 'assistant_text', nativeKind: 'reasoning', text: 'NOT PUBLIC'},
    ]}}], nextCursor: null, lastArchivedSeq: 1, snapshotRequired: false, coverage: 'normalized_events_only'};
    await route.fulfill({json: {code: 0, data}});
  });
  const mount = async () => page.evaluate(async hash => {
    const {mountWorkspacePage} = await import('/src/test-harness/workspace-console.tsx');
    const {default: i18n} = await import('/src/i18n/index.ts');
    await i18n.changeLanguage('en');
    mountWorkspacePage(`${location.origin}/__task/app`, hash);
  }, path);
  await mount();
  return {writes, mount, reads: () => reads, replace: (nextState: string, nextVersion: number, nextRuns?: object[], nextTimeline = timeline) => {
    state = nextState;
    version = nextVersion;
    runs = nextRuns;
    timeline = nextTimeline;
  }};
}

test('repeated catch-up reads cannot reopen a completed task or dispatch work', async ({page}) => {
  const {writes, reads, replace} = await fixture(page, {entries: [request, {...developer, state: 'succeeded'}, review]});
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Confirm completion'}).click();
  const done = page.getByRole('status').filter({hasText: 'Done'});
  await expect(done).toBeVisible();
  replace('open', 1);
  for (let i = 0; i < 2; i++) {
    const before = reads();
    const response = page.waitForResponse(r => r.url().endsWith('/work-decision/list?workItemId=2'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await (await response).finished();
    await expect.poll(reads).toBeGreaterThan(before);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(done).toBeVisible();
  }
  await expect(page.getByRole('button', {name: 'Confirm completion'})).toHaveCount(0);
  expect(writes.map(w => w.path)).toEqual(['/workspace/work-item/update-status']);
});

test('catch-up preserves execution progress even when the task version is unchanged', async ({page}) => {
  const finished = {id: '7', executionId: '77', state: 'succeeded', stateVersion: 4};
  const {writes, replace} = await fixture(page, {entries: [request, {...developer, state: 'succeeded'}, review], runs: [finished]});
  const completion = page.getByRole('button', {name: 'Confirm completion'});
  await expect(completion).toBeVisible();
  replace('open', 2, [{...finished, state: 'running', stateVersion: 3}], [request, developer]);
  const response = page.waitForResponse(r => r.url().endsWith('/work-execution/list?workItemId=2'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(completion).toBeVisible();
  expect(writes).toEqual([]);
});

test('unassigned task shows an actionable handoff, not an idle composer or raw author ID', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const {writes} = await fixture(page);
  await expect(page.getByText('No development employee has been assigned.')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('test-owner', {exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Assign to employee', exact: true}).click();
  await expect(page.getByRole('dialog').getByTestId('workflow-panel')).toBeVisible();
  expect(writes).toEqual([]);
});

test('lost task instruction response survives reload and retries the original request', async ({page}) => {
  const {writes, mount} = await fixture(page, {entries: [request, developer], loseSend: true});
  await expect(page.getByText('Ada', {exact: true}).first()).toBeVisible();
  await page.getByPlaceholder('Add instructions or context…').fill('Keep the original queue');
  await page.getByRole('button', {name: 'Send', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Retry same request'})).toBeVisible();
  await page.reload();
  await mount();
  await page.getByRole('button', {name: 'Retry same request'}).click();
  await expect(page.getByText('Keep the original queue', {exact: true})).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0].path).toBe('/workspace/work-instruction/send');
  expect(writes[1]).toEqual(writes[0]);
});

test('manual workflow opens review controls without changing the task', async ({page}) => {
  const {writes} = await fixture(page, {entries: [request, {...developer, state: 'succeeded'}]});
  await expect(page.getByRole('button', {name: 'Manual workflow'})).toHaveCount(0);
  await page.getByTestId('task-manage').click();
  await page.getByRole('button', {name: 'Manual workflow'}).click();
  await expect(page.getByRole('dialog').getByLabel('Review conclusion')).toHaveValue('');
  expect(writes).toEqual([]);
});

test('the stop control pauses the task, not a raw execution', async ({page}) => {
  const {writes} = await fixture(page, {entries: [request, developer]});
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: 'Pausing work'})).toBeVisible();
  expect(writes.map(w => w.path)).toEqual(['/workspace/work-instruction/pause']);
});

test('finished result renders public Markdown and review still requires owner confirmation', async ({page}) => {
  const {writes} = await fixture(page, {entries: [request, {...developer, state: 'succeeded'}, review]});
  const view = page.getByTestId('task-conversation-page');
  await expect(view.locator('strong')).toHaveText('Reconnect verified');
  await expect(view).not.toContainText('NOT PUBLIC');
  await expect(view.locator('img')).toHaveCount(0);
  await expect(view.getByTestId('delivery-summary')).toContainText('unverified');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Confirm completion'}).click();
  await expect(page.getByRole('status').filter({hasText: 'Done'})).toBeVisible();
  expect(writes).toEqual([{path: '/workspace/work-item/update-status', body: {id: '2', version: 2, status: 'done'}}]);
});

test('other members can see the conversation but cannot drive the task', async ({page}) => {
  const {writes} = await fixture(page, {entries: [request, developer, review], owner: '100000010'});
  await expect(page.getByText('Recover after reconnect')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Confirm completion'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Manual workflow'})).toHaveCount(0);
  await expect(page.getByTestId('task-conversation-page')).not.toContainText('100000010');
  expect(writes).toEqual([]);
});

test('unknown result requires an explicit choice and preserves the task instruction identity', async ({page}) => {
  const {writes} = await fixture(page, {entries: [request, {...developer, state: 'unknown'}], verifyUnknown: true});
  await page.getByPlaceholder('Add instructions or context…').fill('Check this before continuing');
  await page.getByRole('button', {name: 'Send', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Rerun despite the unknown result'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Inspect the previous session first'}).click();
  await expect(page.getByText('Check this before continuing', {exact: true})).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual({...writes[0], body: {...writes[0].body, acknowledgeUnknown: 'inspect'}});
});

const delivered = {...developer, state: 'succeeded'};
const reviewed = {...delivered, id: 't8', role: 'reviewer', employeeId: '13', workExecutionId: '8', at: 3};
const boundCycle = {...review, at: 4, workExecutionId: '7', reviewWorkExecutionId: '8'};
const sourceRun = {id: '7', executionId: '77', state: 'succeeded', workItemVersion: 2};
const reviewRun = {...sourceRun, id: '8', executionId: '88'};
const frozen = {noteId: '19', workItemId: '2', workItemVersion: 2, sourceWorkExecutionId: '7', sourceExecutionId: '77',
  reviewerExecution: reviewRun, evidenceDescription: 'Artifact digest 4fa9', evidenceNoteIds: ['18'],
  conclusionSource: 'human_recorded', conclusionNoteId: '20', conclusion: 'changes_requested', conclusionBody: 'Offline case still fails'};

test('conversation shows bound delivery evidence and separates advice from a recorded verdict for other members', async ({page}) => {
  const {writes} = await fixture(page, {entries: [delivered, reviewed, boundCycle], runs: [sourceRun, reviewRun],
    reviews: [frozen, {...frozen, reviewerExecution: {...reviewRun, id: 'other'}, evidenceDescription: 'Wrong round'}], owner: 'other'});
  const summary = page.getByTestId('delivery-summary');
  await expect(summary.getByText('Artifact digest 4fa9', {exact: false})).toBeHidden();
  await summary.locator('summary').click();
  await expect(summary.getByText('Artifact digest 4fa9', {exact: false})).toBeVisible();
  for (const value of ['Reviewer recommends passing (not acceptance)', '7 · v2', 'Artifact digest 4fa9', '#18', 'Offline case still fails', 'unverified']) {
    await expect(summary).toContainText(value);
  }
  await expect(summary).not.toContainText('Wrong round');
  await expect(page.getByRole('button', {name: 'Confirm completion'})).toHaveCount(0);
  expect(writes).toEqual([]);
});

for (const [name, cycle, record, later] of [
  ['legacy cycle', review, frozen, []],
  ['wrong review link', {...boundCycle, reviewWorkExecutionId: '9'}, frozen, []],
  ['wrong source link', {...boundCycle, workExecutionId: '9'}, frozen, []],
  ['wrong frozen execution', boundCycle, {...frozen, sourceExecutionId: 'old'}, []],
  ['detached review', boundCycle, {...frozen, reviewerExecution: {...reviewRun, detached: true}}, []],
  ['wrong version', boundCycle, {...frozen, workItemVersion: 1}, []],
  ['new development round', boundCycle, frozen, [{...delivered, id: 't9', workExecutionId: '9', at: 5}]],
] as const) {
  test(`conversation does not attribute a verdict to ${name}`, async ({page}) => {
    const {writes} = await fixture(page, {entries: [delivered, reviewed, cycle, ...later], reviews: [record], runs: [sourceRun, reviewRun]});
    const summary = page.getByTestId('delivery-summary');
    await expect(summary).toContainText('Current delivery and review evidence: unverified');
    await expect(summary).not.toContainText('Artifact digest');
    await expect(summary).not.toContainText('Offline case');
    await expect(page.getByRole('status').filter({hasText: 'Review passed'})).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}

test('unavailable evidence does not disable existing owner confirmation or write to the task', async ({page}) => {
  const {writes} = await fixture(page, {entries: [delivered, reviewed, boundCycle], runs: [sourceRun, reviewRun], reviewError: true});
  await expect(page.getByTestId('delivery-summary')).toContainText('Current delivery and review evidence: unverified');
  await expect(page.getByRole('button', {name: 'Confirm completion'})).toBeEnabled();
  expect(writes).toEqual([]);
});
