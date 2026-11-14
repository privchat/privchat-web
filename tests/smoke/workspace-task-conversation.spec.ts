import { expect, test, type Page } from '@playwright/test';

const path = '#/workspace/space/w/item/2';
const developer = {kind: 'turn', id: 't7', at: 2, role: 'developer', employeeId: '12', workExecutionId: '7', state: 'running'};
const request = {kind: 'requirement', id: 'a7', at: 1, text: 'Recover after reconnect'};
const review = {kind: 'cycle', id: 'c1', at: 3, state: 'recommendation_passed'};

async function fixture(page: Page, {entries = [] as object[], owner = 'test-owner', loseSend = false, verifyUnknown = false} = {}) {
  const writes: {path: string; body: Record<string, unknown>}[] = [];
  let timeline = entries;
  let state = 'open';
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
    if (path.endsWith('/workspace/get/w')) data = {id: 'w', name: 'Team', archived: 0, myRole: 'owner'};
    if (path.endsWith('/work-item/get/2')) data = {id: '2', workspaceId: 'w', title: 'Reconnect task', description: '', createdBy: owner, version: 2, status: state};
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
  return {writes, mount};
}

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
  await expect(page.getByText('Review passed — confirm completion', {exact: true})).toBeVisible();
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
