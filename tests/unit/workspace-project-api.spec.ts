import { test, expect } from '@playwright/test';
import { WorkspaceApi, type Member, type Project, type ProjectBinding, type Workspace } from '../../src/features/workspace/api';

const project: Project = {id: 'p', workspaceId: 'w', name: 'Project', archived: 0, version: 2, description: '', manageable: true, roundEnd: '', bindings: []};
const binding: ProjectBinding = {id: 'b', projectId: 'p', userId: 'me', mine: true, nodeId: 'n', nodeName: 'Mac', directories: [{workdirBindingId: 'dir', label: 'Repository', access: 'write'}], notes: '', reviewerEmployeeId: null, version: 1};
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

test('project create/update carry workspace ownership, version and round-end rules, never legacy targets or review basis', async () => {
  await api().createProject({workspaceId: 'w /', name: 'New', description: ' Desc ', roundEnd: '  commit  '});
  await api().updateProject({id: 'p', name: 'Renamed', version: 2});
  await api().updateProject({id: 'p', name: 'Renamed', version: 2, description: '', roundEnd: ' push '});
  expect(calls.map(call => [call.method, call.url.pathname, call.body])).toEqual([
    ['POST', '/app/workspace/project/create', {workspaceId: 'w /', name: 'New', description: ' Desc ', roundEnd: 'commit'}],
    ['PUT', '/app/workspace/project/update', {id: 'p', name: 'Renamed', version: 2}],
    ['PUT', '/app/workspace/project/update', {id: 'p', name: 'Renamed', version: 2, description: '', roundEnd: 'push'}],
  ]);
  expect(calls.every(call => !JSON.stringify(call.body).includes('targets') && !JSON.stringify(call.body).includes('reviewBasis') && !call.url.pathname.includes('/link/'))).toBe(true);
});

test('round-end rules are capped at the server limit on create and update', async () => {
  const long = 'y'.repeat(1500);
  await api().createProject({workspaceId: 'w', name: 'N', roundEnd: long});
  await api().updateProject({id: 'p', name: 'N', version: 1, roundEnd: long});
  expect((calls[0]?.body as {roundEnd: string}).roundEnd).toHaveLength(1000);
  expect((calls[1]?.body as {roundEnd: string}).roundEnd).toHaveLength(1000);
});

test('binding save sends directory ids with access, caps notes, and omits empty reviewer/version', async () => {
  response = binding;
  expect(await api().saveProjectBinding({projectId: 'p', nodeId: 'n', directories: [{workdirBindingId: 'dir', access: 'write'}, {workdirBindingId: 'docs', access: 'read'}], notes: 'x'.repeat(2500), reviewerEmployeeId: null})).toEqual(binding);
  await api().saveProjectBinding({projectId: 'p', nodeId: 'n', directories: [{workdirBindingId: 'dir', access: 'read'}], reviewerEmployeeId: 'reviewer', version: 3});
  expect(calls.map(call => call.body)).toEqual([
    {projectId: 'p', nodeId: 'n', directories: [{workdirBindingId: 'dir', access: 'write'}, {workdirBindingId: 'docs', access: 'read'}], notes: 'x'.repeat(2000)},
    {projectId: 'p', nodeId: 'n', directories: [{workdirBindingId: 'dir', access: 'read'}], notes: '', reviewerEmployeeId: 'reviewer', version: 3},
  ]);
  expect(calls.every(call => call.method === 'POST' && call.url.pathname === '/app/workspace/project/binding/save')).toBe(true);
});

test('binding delete and member removal use DELETE with encoded identities', async () => {
  response = null;
  await api().deleteProjectBinding('b /');
  await api().removeMember('m &');
  expect(calls.map(call => [call.method, call.url.pathname + call.url.search])).toEqual([
    ['DELETE', '/app/workspace/project/binding/delete?id=b+%2F'],
    ['DELETE', '/app/workspace/member/delete/m%20%26'],
  ]);
});

test('space, member and project reads are workspace-scoped and encoded', async () => {
  const space: Workspace = {id: 'w', name: 'Space', description: '', archived: 0, myRole: 'owner'};
  response = space;
  expect(await api().space('w /')).toEqual(space);
  response = [project];
  expect(await api().projects('w /')).toEqual([project]);
  response = {list: [project], total: 21};
  expect(await api().projectPage(2, 'w /')).toEqual(response);
  expect(await api().projectPage(2)).toEqual(response);
  const member: Member = {id: 'm', workspaceId: 'w', userId: 'u', role: 'member'};
  response = [member];
  expect(await api().members('w /')).toEqual([member]);
  expect(calls.map(call => call.url.pathname + call.url.search)).toEqual([
    '/app/workspace/get/w%20%2F',
    '/app/workspace/project/list?workspaceId=w%20%2F',
    '/app/workspace/project/page?pageNo=2&pageSize=20&workspaceId=w%20%2F',
    '/app/workspace/project/page?pageNo=2&pageSize=20',
    '/app/workspace/member/list?workspaceId=w%20%2F',
  ]);
});

test('member writes and archive status use their own contracts with platform auth', async () => {
  const member: Member = {id: 'm', workspaceId: 'w', userId: 'u', role: 'admin'};
  response = member;
  expect(await api().addMember('w', 'u', 'admin')).toEqual(member);
  expect(await api().updateMemberRole('m', 'member')).toEqual(member);
  response = project;
  await api().projectStatus('p', 1, 2);
  await api().projectStatus('p', 0);
  expect(calls.map(call => [call.method, call.url.pathname, call.body])).toEqual([
    ['POST', '/app/workspace/member/create', {workspaceId: 'w', userId: 'u', role: 'admin'}],
    ['PUT', '/app/workspace/member/update-role', {id: 'm', role: 'member'}],
    ['PUT', '/app/workspace/project/update-status', {id: 'p', archived: 1, version: 2}],
    ['PUT', '/app/workspace/project/update-status', {id: 'p', archived: 0}],
  ]);
  expect(calls.every(call => call.authorization === 'Bearer token')).toBe(true);
});
