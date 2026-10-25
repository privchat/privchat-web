import {test, expect} from '@playwright/test';
import {WorkspaceApi} from '../../src/features/workspace/api';
import {mergeActivityPage, validateTaskFeed} from '../../src/features/workspace/task-feed';
import {enWorkspace, zhWorkspace, zhTWWorkspace, viWorkspace} from '../../src/i18n/workspace';

const originalFetch = globalThis.fetch;
const urls: URL[] = [];
let response: unknown;
test.beforeEach(() => {
  urls.length = 0; response = {items: [], nextCursor: 'opaque', olderCursor: 'opaque', hasOlder: true};
  globalThis.fetch = async input => {
    urls.push(new URL(String(input)));
    return new Response(JSON.stringify({code: 0, data: response}), {headers: {'Content-Type': 'application/json'}});
  };
});
test.afterEach(() => {globalThis.fetch = originalFetch;});
const api = () => new WorkspaceApi('https://platform.example/app', () => 'token');

test('modern task views use opaque scoped cursors, never legacy beforeId or client sorting', async () => {
  const scope = {workspaceId: 'w /', projectId: 'p', employeeId: 'e &'};
  expect(await api().tasks('active_tasks_v1', scope, 'cursor /')).toMatchObject({olderCursor: 'opaque', hasOlder: true, refreshRequired: false});
  await api().tasks('history_tasks_v1', {employeeId: 'e', unprojected: true});
  expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({view: 'active_tasks_v1', limit: '20', ...scope, cursor: 'cursor /'});
  expect(Object.fromEntries(urls[1]!.searchParams)).toEqual({view: 'history_tasks_v1', limit: '20', employeeId: 'e', unprojected: 'true'});
  await expect(api().tasks('active_tasks_v1', {})).rejects.toThrow();
  await expect(api().tasks('history_tasks_v1', {projectId: 'p', unprojected: true})).rejects.toThrow();
  expect(urls).toHaveLength(2);
});

test('nextCursor-only and olderCursor compatibility; old task_feed_v1 remains unchanged', async () => {
  response = {items: [], nextCursor: 'next'};
  expect(await api().tasks('history_tasks_v1', {projectId: 'p'})).toMatchObject({olderCursor: 'next', hasOlder: true});
  response = {items: [], olderCursor: null, hasOlder: false, refreshRequired: true};
  expect(await api().tasks('history_tasks_v1', {})).toMatchObject({olderCursor: null, refreshRequired: true});
  await api().taskFeed('w', 'p', 'legacy');
  expect(Object.fromEntries(urls[2]!.searchParams)).toEqual({view: 'task_feed_v1', workspaceId: 'w', projectId: 'p', cursor: 'legacy', limit: '20'});
});

test('details read one item rather than all workspace items', async () => {
  await api().item('item /');
  expect(urls.map(url => url.pathname)).toEqual(['/app/workspace/work-item/get/item%20%2F']);
});

test('cursor loops and foreign unprojected rows fail closed; merge keeps server order and highest version', () => {
  const a = {item: {id: 'a', workspaceId: 'w', title: 'a', description: '', status: 'open', version: 2}, latestExecution: null, executionCount: 0};
  const b = {...a, item: {...a.item, id: 'b', version: 1}};
  expect(mergeActivityPage([a], [b, {...a, item: {...a.item, version: 1}}])).toEqual([a, b]);
  const page = {items: [a], olderCursor: 'same', hasOlder: true, refreshRequired: false};
  expect(() => validateTaskFeed(page, 'w', undefined, 'same')).toThrow();
  expect(() => validateTaskFeed({...page, items: [{...a, item: {...a.item, projectId: 'p'}}]}, 'w', undefined, undefined, true)).toThrow();
});

test('every backend stage has copy in all four existing workspace locales', () => {
  for (const copy of [enWorkspace, zhWorkspace, zhTWWorkspace, viWorkspace]) {
    for (const stage of ['development_pending', 'development_blocked', 'waiting_user', 'awaiting_review', 'awaiting_acceptance', 'development', 'reviewing', 'changes_requested', 'review_passed', 'awaiting_review_record', 'review_blocked', 'review_pending', 'unassigned', 'closed', 'unknown']) {
      expect((copy as Record<string, string>)[`stage_${stage}`]).toBeTruthy();
      expect((copy as Record<string, string>)[`stage_${stage}`]).not.toBe(stage);
      if (stage !== 'development') expect((copy as Record<string, string>)[`stage_${stage}`]).not.toBe(copy.stage_development);
    }
  }
});
