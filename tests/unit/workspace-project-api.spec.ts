import { test, expect } from '@playwright/test';
import { WorkspaceApi, type Project } from '../../src/features/workspace/api';

const project: Project = {id: 'p', ownerUserId: 'owner', writable: true, manageable: true, name: 'Standalone', archived: 0, version: 2, targets: []};
const originalFetch = globalThis.fetch;
const calls: {url: URL; method: string; body: unknown; authorization: string | null}[] = [];
let response: unknown;
test.beforeEach(() => {
  calls.length = 0; response = project;
  globalThis.fetch = async (input, init) => {
    calls.push({url: new URL(String(input)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, authorization: new Headers(init?.headers).get('Authorization')});
    return new Response(JSON.stringify({code: 0, data: response}), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
});
test.afterEach(() => {globalThis.fetch = originalFetch;});
const api = () => new WorkspaceApi('https://platform.example/app', () => 'token');

test('default review employee is a single optional reference; omission preserves and null clears', async () => {
  await api().saveProject({name: 'New', defaultReviewerEmployeeId: 'reviewer'});
  await api().saveProject({id: 'p', name: 'Existing', version: 2});
  await api().saveProject({id: 'p', name: 'Existing', version: 2, defaultReviewerEmployeeId: 'another'});
  await api().saveProject({id: 'p', name: 'Existing', version: 2, defaultReviewerEmployeeId: null});
  expect(calls.map(call => call.body)).toEqual([
    {name: 'New', targets: [], defaultReviewerEmployeeId: 'reviewer'},
    {id: 'p', name: 'Existing', version: 2},
    {id: 'p', name: 'Existing', version: 2, updateDefaultReviewer: true, defaultReviewerEmployeeId: 'another'},
    {id: 'p', name: 'Existing', version: 2, updateDefaultReviewer: true, defaultReviewerEmployeeId: null},
  ]);
  expect(calls.every(call => !call.url.pathname.includes('/work-execution/') && !call.url.pathname.includes('/work-note/'))).toBe(true);
});

test('canonical standalone create strips legacy ownership and target IDs; empty targets are explicit', async () => {
  const legacy = {workspaceId: 'legacy', ownerUserId: 'ignored', writable: false, name: 'Standalone', targets: [{id: 'old', nodeId: 'n', workdirBindingId: 'd'}]};
  expect(await api().saveProject(legacy)).toEqual(project);
  await api().saveProject({name: 'Empty'});
  expect(calls.map(call => [call.url.pathname, call.method, call.body])).toEqual([
    ['/app/workspace/project/create', 'POST', {name: 'Standalone', targets: [{nodeId: 'n', workdirBindingId: 'd'}]}],
    ['/app/workspace/project/create', 'POST', {name: 'Empty', targets: []}],
  ]);
});

test('versioned project updates exclude workspace and permission metadata', async () => {
  const legacy = {...project, workspaceId: null};
  await api().saveProject(legacy);
  await api().projectStatus('p', 1, 2);
  expect(calls.map(call => [call.method, call.body])).toEqual([
    ['PUT', {id: 'p', name: 'Standalone', version: 2, targets: []}],
    ['PUT', {id: 'p', archived: 1, version: 2}],
  ]);
});

test('standalone pagination and explicit workspace project queries use separate contracts', async () => {
  response = {list: [project], total: 21};
  expect(await api().projectPage(2)).toEqual(response);
  response = [project];
  expect(await api().projects('w &/')).toEqual([project]);
  expect(await api().projectLinks('w &/')).toEqual([project]);
  expect(calls[0]?.url.searchParams.toString()).toBe('pageNo=2&pageSize=20');
  expect(calls.slice(1).map(call => [call.url.pathname, call.url.searchParams.get('workspaceId')])).toEqual([
    ['/app/workspace/project/list', 'w &/'], ['/app/workspace/project/link/list', 'w &/'],
  ]);
});

test('link creates only the association and unlink accepts a payload-free success', async () => {
  expect(await api().linkProject('w &/', 'p ?/')).toEqual(project);
  response = null;
  await api().unlinkProject('w &/', 'p ?/');
  expect(calls[0]).toMatchObject({method: 'POST', body: {workspaceId: 'w &/', projectId: 'p ?/'}});
  expect(calls[0]?.url.pathname).toBe('/app/workspace/project/link/create');
  expect(calls[1]?.url.pathname).toBe('/app/workspace/project/link/delete');
  expect(calls[1]?.method).toBe('DELETE');
  expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({workspaceId: 'w &/', projectId: 'p ?/'});
  expect(calls.every(call => call.authorization === 'Bearer token')).toBe(true);
});
