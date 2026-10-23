import { test, expect, type Page, type Route } from '@playwright/test';
import { enWorkspace, zhWorkspace, zhTWWorkspace, viWorkspace } from '../../src/i18n/workspace';

const task = (id = '31', status = 'in_progress') => ({id, workspaceId: '21', title: `Task ${id}`, description: 'Real task description', status, version: 2});
const activity = (id = '31', state: string | null = 'running') => ({item: task(id), latestExecution: state === null ? null : {id: `link-${id}`, executionId: `execution-${id}`, state}, executionCount: state === null ? 0 : 2});
const event = (seq: number, executionId = '1', text = `Public event ${seq}`) => ({protocolVersion: 1, executionId, eventId: `${executionId}-${seq}`, seq, kind: 'output', payload: {items: [{kind: 'assistant_text', text}]}});
const archive = (items = [event(1)], nextCursor: string | null = null, snapshotRequired = false) => ({items, nextCursor, snapshotRequired, lastArchivedSeq: items.at(-1)?.seq ?? 0, coverage: 'normalized_events_only'});
type Handler = (route: Route, url: URL) => Promise<void>;
const reply = (route: Route, data: unknown) => route.fulfill({json: {code: 0, data}});

async function routes(page: Page, handlers: {activity?: Handler; records?: Handler; executions?: Handler} = {}) {
  const writes: string[] = [];
  await page.route('**/__wf05/app/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() !== 'GET') writes.push(path);
    if (path.endsWith('/activity/page') && handlers.activity) return handlers.activity(route, url);
    if (path.endsWith('/sessions/records') && handlers.records) return handlers.records(route, url);
    if (path.endsWith('/executions/get') && handlers.executions) return handlers.executions(route, url);
    let data: unknown = [];
    if (path.endsWith('/workspace/list')) data = [{id: '21', name: 'Team', archived: 0, myRole: 'owner'}, {id: '22', name: 'Other team', archived: 0, myRole: 'owner'}];
    if (path.endsWith('/room/join')) data = {channelId: '400', channelType: 3, ticket: 'fixture', expiresAt: Date.now() + 60000, eventProtocolVersion: 1};
    if (path.endsWith('/work-item/list')) data = [task()];
    if (path.endsWith('/activity/page')) data = {items: [activity()], nextCursor: null};
    if (path.endsWith('/executions/get')) data = {executionId: url.searchParams.get('executionId'), nodeId: '8', state: 'running', stateVersion: 1};
    if (path.endsWith('/executions/children')) data = {items: [], nextCursor: null};
    if (path.endsWith('/sessions/records')) data = archive([event(1, url.searchParams.get('executionId')!)]);
    await reply(route, data);
  });
  return writes;
}
async function mountWorkspace(page: Page) {
  await page.evaluate(async () => {const {mountWorkspaceConsole} = await import('/src/test-harness/workspace-console.tsx'); mountWorkspaceConsole(`${location.origin}/__wf05/app`);});
  await page.getByTestId('workspace-console').locator('select').first().selectOption('21');
  await page.getByRole('button', {name: 'Task activity', exact: true}).click();
  return page.getByTestId('workspace-activity');
}
async function mountRecords(page: Page) {
  await page.evaluate(async () => {
    const {mountRecordsConsole} = await import('/src/test-harness/workspace-console.tsx');
    (window as any).selectWf05Execution = mountRecordsConsole(`${location.origin}/__wf05/app`);
  });
  return page.getByTestId('session-records');
}
async function selectExecution(page: Page, executionId: string) {
  await page.evaluate(id => (window as any).selectWf05Execution(id), executionId);
}

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.evaluate(async () => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage('en');});
});

test('activity separates work status from execution status and all terminal branches omit no-final-result claims', async ({page}) => {
  const states = [null, 'running', 'succeeded', 'failed', 'cancelled'];
  const writes = await routes(page, {activity: route => reply(route, {items: states.map((state, i) => ({...activity(String(31 + i), state), result: {summary: 'DO NOT GUESS FINAL SUMMARY'}})), nextCursor: null})});
  const feed = await mountWorkspace(page);
  await expect(feed.getByTestId('activity-item')).toHaveCount(5);
  for (let i = 0; i < states.length; i++) {
    const card = feed.getByTestId('activity-item').nth(i);
    await expect(card).toContainText('Work item status: In progress');
    await expect(card.getByRole('button', {name: 'Open work details'})).toBeEnabled();
    if (i < 2) await expect(card).toContainText(enWorkspace.noFinalResult);
    else {await expect(card).not.toContainText(enWorkspace.noFinalResult); await expect(card).toContainText(enWorkspace.executionDetailsHint);}
  }
  await expect(feed.getByTestId('activity-item').nth(2)).toContainText(enWorkspace.execution_succeeded);
  await expect(feed).not.toContainText('DO NOT GUESS FINAL SUMMARY');
  await feed.getByTestId('activity-item').nth(1).getByRole('button', {name: 'Open work details'}).click();
  await expect(page.getByTestId('work-item-panel').getByRole('heading', {name: 'Task 32'})).toBeVisible();
  await expect(page.getByTestId('session-records')).toContainText('Public event 1');
  expect(writes.every(path => path.endsWith('/room/join'))).toBe(true);
});

test('activity pagination keeps one post per item and does not replace latest round with an overlapping old row', async ({page}) => {
  const cursors: (string | null)[] = [];
  await routes(page, {activity: (route, url) => {
    expect(url.searchParams.get('limit')).toBe('20');
    const cursor = url.searchParams.get('beforeId'); cursors.push(cursor);
    return reply(route, {items: cursor ? [activity('31', 'succeeded'), activity('30', null)] : [activity('31')], nextCursor: cursor ? null : '31'});
  }});
  const feed = await mountWorkspace(page);
  await feed.getByRole('button', {name: 'Load more'}).click();
  await expect(feed.getByTestId('activity-item')).toHaveCount(2);
  await expect(feed.getByTestId('activity-item').first()).toContainText(enWorkspace.execution_running);
  expect(cursors).toEqual([null, '31']);
  await feed.getByTestId('activity-item').last().getByRole('button', {name: 'Open work details'}).click();
  await expect(page.getByTestId('work-item-panel').getByRole('heading', {name: 'Task 30'})).toBeVisible();
  await expect(page.getByTestId('session-console')).toHaveCount(0);
});

test('activity pagination authorization failure clears cards and the opened task/execution', async ({page}) => {
  await routes(page, {activity: (route, url) => url.searchParams.has('beforeId') ? route.fulfill({status: 403, json: {}}) : reply(route, {items: [activity()], nextCursor: '31'})});
  const feed = await mountWorkspace(page);
  await feed.getByRole('button', {name: 'Open work details'}).click();
  await expect(page.getByTestId('session-records')).toContainText('Public event 1');
  await feed.getByRole('button', {name: 'Load more'}).click();
  await expect(page.getByTestId('activity-item')).toHaveCount(0);
  await expect(page.getByTestId('work-item-panel')).toHaveCount(0);
  await expect(page.getByTestId('session-console')).toHaveCount(0);
  await expect(page.getByTestId('workspace-console')).toContainText(enWorkspace.denied);
});

test('activity old backend degrades without fabricating posts or losing existing work list', async ({page}) => {
  await routes(page, {activity: route => route.fulfill({status: 404, json: {}})});
  const feed = await mountWorkspace(page);
  await expect(feed).toContainText(enWorkspace.activityUnsupported);
  await expect(feed.getByTestId('activity-item')).toHaveCount(0);
  await expect(page.getByRole('option', {name: 'Task 31 · in_progress'})).toBeAttached();
});

test('archive pages use afterSeq cursor, show coverage/gaps, and render only public text/status', async ({page}) => {
  const cursors: string[] = [];
  const writes = await routes(page, {records: (route, url) => {
    expect(url.searchParams.get('limit')).toBe('50');
    const after = url.searchParams.get('afterSeq')!; cursors.push(after);
    const first = {...event(1), payload: {items: [{kind: 'assistant_text', text: 'Public first'}, {kind: 'reasoning', text: 'SECRET CHAIN'}, {kind: 'assistant_text', nativeKind: 'reasoning', text: 'NATIVE SECRET'}, {kind: 'tool_summary', text: '<script>literal tool text</script>', input: {token: 'PRIVATE TOKEN'}}], hidden: 'DO NOT STRINGIFY'}};
    const state = {...event(2), kind: 'state', payload: {state: 'running', nativeSessionId: 'PRIVATE SESSION'}};
    return reply(route, after === '0' ? archive([first, state] as any, '2', true) : archive([event(3)], null));
  }});
  const records = await mountRecords(page);
  await expect(records).toContainText('Public first');
  await expect(records).toContainText(enWorkspace.archiveCoverage);
  await expect(records).toContainText(enWorkspace.archiveGap);
  await expect(records).toContainText(enWorkspace.execution_running);
  await expect(records).toContainText('<script>literal tool text</script>');
  await expect(records).not.toContainText(/SECRET|PRIVATE|DO NOT STRINGIFY/);
  await expect(records.locator('script')).toHaveCount(0);
  await records.getByRole('button', {name: 'Load more'}).click();
  await expect(records.getByTestId('archived-event')).toHaveCount(3);
  await expect(records).toContainText('Public event 3');
  await expect(records).toContainText(enWorkspace.archiveGap);
  expect(cursors).toEqual(['0', '2']);
  expect(writes).toEqual([]);
});

test('switching executions fences a delayed old archive page and resets record/cursor state', async ({page}) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let pending = false;
  await routes(page, {records: async (route, url) => {
    const id = url.searchParams.get('executionId')!;
    if (id === '1' && url.searchParams.get('afterSeq') === '1') {pending = true; await gate; await reply(route, archive([event(2, '1', 'LATE OLD EXECUTION')]));}
    else await reply(route, archive([event(1, id, id === '1' ? 'Old execution' : 'New execution')], id === '1' ? '1' : null));
  }});
  const records = await mountRecords(page);
  await expect(records).toContainText('Old execution');
  await records.getByRole('button', {name: 'Load more'}).click();
  await expect.poll(() => pending).toBe(true);
  await selectExecution(page, '2');
  await expect(records).toContainText('New execution');
  const delivered = page.waitForResponse(response => response.url().includes('/sessions/records?executionId=1&afterSeq=1'));
  release();
  await delivered;
  await expect(records).not.toContainText(/Old execution|LATE OLD EXECUTION/);
  await expect(records.getByRole('button', {name: 'Load more'})).toHaveCount(0);
});

for (const deniedBy of ['records', 'execution']) {
  test(`current ${deniedBy} authorization refusal clears archived display and disables node controls`, async ({page}) => {
    let denied = false;
    await routes(page, {
      records: (route, url) => denied && deniedBy === 'records' ? route.fulfill({json: {code: 403, message: 'DENIED'}}) : reply(route, archive([event(1, url.searchParams.get('executionId')!, 'Visible before revocation')], '1')),
      executions: (route, url) => denied && deniedBy === 'execution' ? route.fulfill({status: 401, json: {}}) : reply(route, {executionId: url.searchParams.get('executionId'), nodeId: '8', state: 'running', stateVersion: 1}),
    });
    const records = await mountRecords(page);
    await expect(records).toContainText('Visible before revocation');
    denied = true;
    if (deniedBy === 'records') await records.getByRole('button', {name: 'Refresh'}).click();
    const session = page.getByTestId('session-console');
    await expect(session).toContainText(enWorkspace.denied);
    await expect(session).not.toContainText('Visible before revocation');
    await expect(session.getByRole('button', {name: enWorkspace.watch, exact: true})).toBeDisabled();
  });
}

for (const status of [404, 405, 501]) {
  test(`archive missing API (${status}) explains partial support without invoking node history/watch`, async ({page}) => {
    const writes = await routes(page, {records: route => route.fulfill({status, json: {}})});
    const records = await mountRecords(page);
    await expect(records).toContainText(enWorkspace.archiveUnsupported);
    await expect(records).toContainText(enWorkspace.archiveCoverage);
    await expect(records.getByTestId('archived-event')).toHaveCount(0);
    await expect(page.getByTestId('session-console').getByRole('button', {name: enWorkspace.watch, exact: true})).toBeEnabled();
    expect(writes).toEqual([]);
  });
}

for (const invalid of ['missing-owner', 'wrong-owner', 'wrong-version', 'out-of-order', 'out-of-range', 'cursor-mismatch', 'replayed-sequence']) {
  test(`rejects malformed archive page before display: ${invalid}`, async ({page}) => {
    await routes(page, {records: (route, url) => {
      if (url.searchParams.get('afterSeq') === '0') return reply(route, archive([event(1)], '1'));
      const bad = archive([event(2), event(3)], '3');
      if (invalid === 'missing-owner') delete (bad.items[0] as any).executionId;
      if (invalid === 'wrong-owner') bad.items[0]!.executionId = 'other';
      if (invalid === 'wrong-version') bad.items[0]!.protocolVersion = 2;
      if (invalid === 'out-of-order') bad.items.reverse();
      if (invalid === 'out-of-range') bad.lastArchivedSeq = 2;
      if (invalid === 'cursor-mismatch') bad.nextCursor = '2';
      if (invalid === 'replayed-sequence') bad.items[0]!.seq = 1;
      return reply(route, bad);
    }});
    const records = await mountRecords(page);
    await expect(records).toContainText('Public event 1');
    await records.getByRole('button', {name: 'Load more'}).click();
    await expect(records.getByRole('alert')).toHaveText(enWorkspace.error);
    await expect(records.getByTestId('archived-event')).toHaveCount(1);
    await expect(records).not.toContainText(/Public event 2|Public event 3/);
  });
}

for (const [locale, copy] of Object.entries({en: enWorkspace, 'zh-CN': zhWorkspace, 'zh-TW': zhTWWorkspace, vi: viWorkspace})) {
  test(`WF-05 archive and activity render localized narrow-screen text (${locale})`, async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await routes(page);
    const feed = await mountWorkspace(page);
    await expect(feed.getByTestId('activity-item')).toHaveCount(1);
    await feed.getByRole('button', {name: 'Open work details'}).click();
    await expect(page.getByTestId('session-records')).toContainText('Public event 1');
    await page.evaluate(async locale => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage(locale);}, locale);
    await expect(feed).toContainText(copy.activityHint);
    await expect(feed).toContainText(copy.noFinalResult);
    await expect(page.getByTestId('session-records')).toContainText(copy.archiveCoverage);
    const box = await page.getByRole('dialog').boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    // The modal overlays the existing chat test shell; assert this feature's bounds, not that unrelated shell.
    expect(await feed.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.getByTestId('session-records').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

for (const machineCode of ['AGENT_NODE_REVOKED', 'AGENT_CAPABILITY_NOT_GRANTED', 'AGENT_SESSION_BUSY']) {
  test(`records refresh handles 10200 ${machineCode} without broad numeric denial`, async ({page}) => {
    let reads = 0;
    await routes(page, {records: route => ++reads === 1 ? reply(route, archive([event(1, '1', 'Previously authorized record')])) : route.fulfill({json: {code: 10200, message: machineCode}})});
    const records = await mountRecords(page);
    await expect(records).toContainText('Previously authorized record');
    await records.getByRole('button', {name: 'Refresh'}).click();
    const session = page.getByTestId('session-console');
    if (machineCode === 'AGENT_SESSION_BUSY') {
      await expect(records.getByRole('alert')).toHaveText(enWorkspace.error);
      await expect(session.getByRole('button', {name: enWorkspace.watch, exact: true})).toBeEnabled();
      await expect(session).not.toContainText(enWorkspace.denied);
    } else {
      await expect(session).toContainText(enWorkspace.denied);
      await expect(session).not.toContainText('Previously authorized record');
      await expect(session.getByRole('button', {name: enWorkspace.watch, exact: true})).toBeDisabled();
    }
  });
}

for (const [locale, copy] of Object.entries({en: enWorkspace, 'zh-CN': zhWorkspace, 'zh-TW': zhTWWorkspace, vi: viWorkspace})) {
  test(`archived permission events are inert historical titles, never approval controls (${locale})`, async ({page}) => {
    const writes = await routes(page, {records: route => reply(route, archive([
      {...event(1), kind: 'permission_requested', payload: {permissionId: 'historical', summary: 'PRIVATE RAW INPUT', requestDigest: 'PRIVATE DIGEST'}},
      {...event(2), kind: 'permission_resolved', payload: {permissionId: 'historical', decision: 'allow_once', input: 'PRIVATE RAW INPUT'}},
    ] as any))});
    const records = await mountRecords(page);
    await page.evaluate(async locale => {const {default: i18n} = await import('/src/i18n/index.ts'); await i18n.changeLanguage(locale);}, locale);
    await expect(records).toContainText(copy.record_permission_requested);
    await expect(records).toContainText(copy.record_permission_resolved);
    await expect(records.getByText(copy.record_permission_hint)).toHaveCount(2);
    await expect(records).not.toContainText(/PRIVATE|allow_once|historical$/);
    await expect(records.getByRole('button')).toHaveCount(1); // Refresh only; historical records cannot approve anything.
    expect(writes).toEqual([]);
  });
}

test('changing workspaces discards delayed activity responses from the previous space', async ({page}) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let pending = false;
  await routes(page, {activity: async (route, url) => {
    const workspaceId = url.searchParams.get('workspaceId');
    if (workspaceId === '21') {pending = true; await gate; return reply(route, {items: [{...activity(), item: {...task(), title: 'LATE OLD WORKSPACE'}}], nextCursor: null});}
    return reply(route, {items: [{...activity('22'), item: {...task('22'), workspaceId: '22', title: 'Current workspace task'}}], nextCursor: null});
  }});
  const feed = await mountWorkspace(page);
  await expect.poll(() => pending).toBe(true);
  await page.getByTestId('workspace-console').locator('select').first().selectOption('22');
  await page.getByRole('button', {name: 'Task activity', exact: true}).click();
  await expect(feed).toContainText('Current workspace task');
  const delivered = page.waitForResponse(response => response.url().includes('/activity/page?workspaceId=21'));
  release(); await delivered;
  await expect(feed).not.toContainText('LATE OLD WORKSPACE');
  await expect(feed.getByTestId('activity-item')).toHaveCount(1);
});
