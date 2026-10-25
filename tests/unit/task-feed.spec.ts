import { test, expect } from '@playwright/test';
import { historical, mergeTaskFeed, mergeActivityPage, unfinishedTaskFeed, validateTaskFeed } from '../../src/features/workspace/task-feed';
import { CreateItemIntent } from '../../src/features/workspace/create-item-intent';
import type { WorkspaceActivity, WorkspaceApi } from '../../src/features/workspace/api';
const row = (id: string, status = 'open', createdAt = 10, closedAt: number | null = null, version = 1): WorkspaceActivity => ({item: {id, workspaceId: 'w', title: id, description: '', status, createdAt, closedAt, version}, latestExecution: {id: `e-${id}`, executionId: `e-${id}`, state: 'succeeded'}, executionCount: 2});
test('home excludes only business-ended tasks, not approval, failure or successful executions', () => {
  const rows = [row('1', 'done'), row('2', 'cancelled'), row('3', 'awaiting_approval'), row('4', 'blocked'), row('5', 'in_progress'), row('6')];
  rows[3]!.latestExecution!.state = 'failed';
  expect(unfinishedTaskFeed(rows).map(r => r.item.id)).toEqual(['3', '4', '5', '6']);
  expect(rows.map(r => r.item.id)).toEqual(['1', '2', '3', '4', '5', '6']);
});
test('home closes tasks after version merge and server order is preserved without attention or timestamp sorting', () => {
  const rows = mergeTaskFeed([row('2'), row('3', 'open', 30)], [row('2', 'done', 10, 40, 2), row('1', 'open', 20)]);
  expect(unfinishedTaskFeed(mergeActivityPage([], [row('3'), row('1', 'open', 50)] )).map(r => r.item.id)).toEqual(['3', '1']);
  expect(rows.find(r => r.item.id === '2')?.item.status).toBe('done');
});
test('groups by business closing time, then unfinished creation time and numeric ID; success is not acceptance', () => {
  expect(mergeTaskFeed([], [row('10'), row('2'), row('4', 'cancelled', 500, 60), row('3', 'done', 800, 40), row('1', 'done'), row('5', 'in_progress', 20)]).map(r => r.item.id)).toEqual(['1', '3', '4', '2', '10', '5']);
  expect(historical(row('2'))).toBe(false);
});
test('paging merges highest business version and completion moves one card', () => {
  expect(mergeTaskFeed([row('2'), row('3')], [row('2', 'done', 10, 90, 2), row('3', 'done', 10, 30, 0)]).map(r => [r.item.id, r.item.status, r.item.version])).toEqual([['2', 'done', 2], ['3', 'open', 1]]);
});
test('rejects foreign workspace/project and unusable older cursor', () => {
  const page = {items: [row('1')], olderCursor: null, hasOlder: false, refreshRequired: false};
  expect(validateTaskFeed(page, 'w')).toBe(page);
  expect(() => validateTaskFeed(page, 'other')).toThrow(); expect(() => validateTaskFeed(page, 'w', 'p')).toThrow(); expect(() => validateTaskFeed({...page, hasOlder: true}, 'w')).toThrow();
});
const input = {workspaceId: 'w', title: 'Task', description: 'Build', acceptance: 'Pass', projectId: null};
const assignment = {employeeId: 'emp', bindingId: 'binding', text: 'Build'};
test('lost create and assignment responses reuse original identities and saved item', async () => {
  const calls: {path: string; body: any}[] = []; let createLost = true, assignLost = true;
  const api = {post: async (path: string, body: unknown) => {calls.push({path, body}); if (path.endsWith('/create')) {if (createLost) {createLost = false; throw Error('lost');} return row('42').item;} if (assignLost) {assignLost = false; throw Error('lost');} return {executionId: 'exec'};}} as WorkspaceApi;
  const intent = new CreateItemIntent();
  await expect(intent.run(api, input, assignment)).rejects.toThrow('lost'); await expect(intent.run(api, {...input, title: 'changed'}, assignment)).rejects.toThrow('original');
  await expect(intent.run(api, input, assignment)).rejects.toThrow('lost'); expect(intent.item?.id).toBe('42'); await intent.run(api, input, assignment);
  expect(calls).toHaveLength(4); expect(calls[0]).toEqual(calls[1]); expect(calls[2]).toEqual(calls[3]); expect(calls[2]?.body.workItemId).toBe('42'); expect(calls[0]?.body.requestId).not.toBe(calls[2]?.body.requestId);
});
test('create only saves one item and never invokes employee', async () => {
  const calls: string[] = []; const api = {post: async (path: string) => {calls.push(path); return row('42').item;}} as WorkspaceApi;
  await new CreateItemIntent().run(api, input); expect(calls).toEqual(['/workspace/work-item/create']);
});

test('reload restores saved item, frozen input and assignment identity instead of creating again', async () => {
  let stored: any;
  const journal = {load: () => structuredClone(stored), save: (value: unknown) => {stored = structuredClone(value);}, assertScope: () => {}};
  const calls: {path: string; body: any}[] = [];
  let lose = true;
  const api = {post: async (path: string, body: any) => {calls.push({path, body}); if (path.endsWith('/create')) return row('42').item; if (lose) {lose = false; throw Error('lost');} return {executionId: 'exec'};}} as WorkspaceApi;
  await expect(new CreateItemIntent(journal).run(api, input, assignment)).rejects.toThrow('lost');
  const restored = new CreateItemIntent(journal); expect(restored.item?.id).toBe('42'); expect(restored.input).toEqual(input);
  await restored.retry(api);
  expect(calls.filter(c => c.path.endsWith('/create'))).toHaveLength(1); expect(calls[1]).toEqual(calls[2]); expect(stored).toBeUndefined();
});
test('corrupt journal fails closed and sends nothing', async () => {
  const intent = new CreateItemIntent({load: () => {throw Error('corrupt');}, save: () => {}, assertScope: () => {}});
  let sent = false; const api = {post: async () => {sent = true;}} as unknown as WorkspaceApi;
  expect(intent.locked).toBe(true); await expect(intent.run(api, input)).rejects.toThrow('corrupt'); expect(sent).toBe(false);
});

import { spaceSession } from '../../src/features/workspace/space-session';
import type { WorkspaceEmployee } from '../../src/features/workspace/api';
import { workspacePageLocales } from '../../src/features/workspace/page-labels';
test('private bindings cannot become a workspace continuation or a claim of first session', () => {
  const employee: WorkspaceEmployee & {executionId: string; nativeSessionId: string} = {id: 'ref', workspaceId: 'w', employeeId: 'emp', available: true, projectTargetIds: [], executionId: 'private-exec', nativeSessionId: 'private-native'};
  expect(spaceSession(employee)).toEqual({kind: 'unknown'});
  expect(spaceSession({...employee, workspaceSessionKnown: true})).toEqual({kind: 'firstSend'});
  expect(spaceSession({...employee, workspaceSessionKnown: true, workspaceExecutionId: 'space-pending'})).toEqual({kind: 'unknown'});
  expect(spaceSession({...employee, workspaceSessionKnown: true, workspaceNativeSessionId: 'space-native'})).toEqual({kind: 'bound', nativeSessionId: 'space-native'});
});
test('all four workspace page locales have nonempty matching keys', () => {
  for (const copy of Object.values(workspacePageLocales)) {expect(Object.keys(copy).sort()).toEqual(Object.keys(workspacePageLocales.en).sort()); expect(Object.values(copy).every(value => value.trim().length > 0)).toBe(true);}
});

import { retainBlockedDelivery, deliveryReceipt } from '../../src/features/workspace/delivery-receipt';
import { ConsoleIntent } from '../../src/features/workspace/console-intent';
import type { WorkExecution, WorkReview } from '../../src/features/workspace/api';

test('blocked accepted assignment persists original item, request and receipt across reload; never completes or recreates', async () => {
  let stored: any; let blocked = true;
  const journal = {load: () => structuredClone(stored), save: (value: unknown) => {stored = structuredClone(value);}, assertScope: () => {}};
  const calls: {path: string; body: any}[] = [];
  const api = {post: async (path: string, body: any) => {calls.push({path, body}); return path.endsWith('/create') ? row('42').item : {id: 'link', executionId: 'accepted-held', state: 'accepted', deliveryBlockedReason: blocked ? 'WORKSPACE_PROJECT_CHANGED' : null};}} as WorkspaceApi;
  const initial = new CreateItemIntent(journal); await initial.run(api, input, assignment);
  expect(initial.assignmentReceipt?.executionId).toBe('accepted-held'); expect(initial.assign.hasPending).toBe(true); expect(stored.completed).toBe(false);
  const restored = new CreateItemIntent(journal); await restored.retry(api);
  expect(restored.assignmentReceipt?.deliveryBlockedReason).toBe('WORKSPACE_PROJECT_CHANGED'); expect(stored).toBeDefined();
  await expect(restored.run(api, input, {...assignment, employeeId: 'replacement'})).rejects.toThrow('original');
  blocked = false; await restored.retry(api);
  expect(calls.filter(call => call.path.endsWith('/create'))).toHaveLength(1);
  const assigns = calls.filter(call => call.path.endsWith('/assign')); expect(assigns).toHaveLength(3); expect(assigns[0]).toEqual(assigns[1]); expect(assigns[1]).toEqual(assigns[2]); expect(stored).toBeUndefined();
});
for (const review of [false, true]) test(`blocked ${review ? 'review' : 'assignment'} keeps existing console request despite execution identity`, async () => {
  let blocked = true; const calls: any[] = [];
  const receipt = (): WorkExecution => ({id: 'link', executionId: 'accepted-held', state: 'accepted', deliveryBlockedReason: blocked ? 'AUTHORITY_CHANGED' : undefined});
  const api = {post: async (_path: string, body: any) => {calls.push(body); return review ? {reviewerExecution: receipt()} as WorkReview : receipt();}} as WorkspaceApi;
  const intent = new ConsoleIntent(); const path = review ? '/workspace/work-note/request-review' : '/workspace/work-execution/assign';
  const result = await intent.run<WorkExecution | WorkReview>(api, path, {workItemId: '42'}, 'requestId', retainBlockedDelivery);
  expect(deliveryReceipt(result).executionId).toBe('accepted-held'); expect(intent.hasPending).toBe(true);
  await expect(intent.run(api, path, {workItemId: 'other'}, 'requestId', retainBlockedDelivery)).rejects.toThrow('original');
  blocked = false; await intent.retry(api, retainBlockedDelivery); expect(calls[0]).toEqual(calls[1]); expect(intent.hasPending).toBe(false);
});
