import { test, expect } from '@playwright/test';
import { EmployeePages, validateEmployeePage } from '../../src/features/workspace/employee-pages';
import type { WorkspaceApi, WorkspaceEmployee, WorkspaceEmployeePage } from '../../src/features/workspace/api';

const employee = (id: number, available = false): WorkspaceEmployee => ({id: String(id), workspaceId: 'w', employeeId: `employee-${id}`, name: `Employee ${id}`, available, unavailableReason: available ? null : 'offline', projectTargetIds: []});
const first: WorkspaceEmployeePage = {items: Array.from({length: 100}, (_, i) => employee(i + 1)), nextCursor: 'opaque-reference-100', hasMore: true};
const last: WorkspaceEmployeePage = {items: [employee(101, true)], nextCursor: null, hasMore: false};
const api = (load: (workspaceId: string, projectId?: string, cursor?: string) => Promise<WorkspaceEmployeePage>): Pick<WorkspaceApi, 'employeePage'> => ({employeePage: load});

test('100 unavailable references still expose more; employee 101 is discoverable and assignable without losing unavailable rows', async () => {
  const calls: Array<string | undefined> = [];
  const pages = new EmployeePages(api(async (_, __, cursor) => {calls.push(cursor); return cursor ? last : first;}), 'w');
  await pages.refresh();
  expect(pages.getSnapshot().rows).toHaveLength(100);
  expect(pages.getSnapshot().rows.filter(row => row.available)).toHaveLength(0);
  expect(pages.getSnapshot().hasMore).toBe(true);
  await pages.more();
  expect(calls).toEqual([undefined, 'opaque-reference-100']);
  expect(pages.getSnapshot().rows).toHaveLength(101);
  expect(pages.getSnapshot().rows.filter(row => !row.available)).toHaveLength(100);
  expect(pages.getSnapshot().rows.filter(row => row.available).map(row => row.employeeId)).toEqual(['employee-101']);
  expect(pages.getSnapshot().hasMore).toBe(false);
});
test('ordinary refresh reloads the expanded window so selected employee 101 does not disappear', async () => {
  const calls: Array<string | undefined> = [];
  const pages = new EmployeePages(api(async (_, __, cursor) => {calls.push(cursor); return cursor ? last : first;}), 'w', 'project');
  await pages.refresh(); await pages.more(); await pages.refresh();
  expect(calls).toEqual([undefined, 'opaque-reference-100', undefined, 'opaque-reference-100']);
  expect(pages.getSnapshot().rows.at(-1)?.employeeId).toBe('employee-101');
});
test('failed more retains rows and raw cursor; retry does not skip employee 101', async () => {
  let fail = true; const cursors: Array<string | undefined> = [];
  const pages = new EmployeePages(api(async (_, __, cursor) => {cursors.push(cursor); if (cursor && fail) {fail = false; throw Error('network');} return cursor ? last : first;}), 'w');
  await pages.refresh(); await pages.more();
  expect(pages.getSnapshot()).toMatchObject({error: true, hasMore: true, nextCursor: first.nextCursor}); expect(pages.getSnapshot().rows).toHaveLength(100);
  await pages.more(); expect(cursors).toEqual([undefined, first.nextCursor, first.nextCursor]); expect(pages.getSnapshot().rows).toHaveLength(101);
});
test('adjacent duplicate reference updates availability without duplicate rows; empty filtered candidate set does not stop paging', async () => {
  const pages = new EmployeePages(api(async (_, __, cursor) => cursor ? {...last, items: [employee(100, true), employee(101, true)]} : first), 'w');
  await pages.refresh(); await pages.more(); expect(pages.getSnapshot().rows).toHaveLength(101);
  expect(pages.getSnapshot().rows.filter(row => row.available).map(row => row.employeeId)).toEqual(['employee-100', 'employee-101']);
});
test('project scope is sent on every page; disposed filter response cannot repopulate old rows', async () => {
  const calls: unknown[][] = []; let release!: (page: WorkspaceEmployeePage) => void;
  const loader = api(async (...args) => {calls.push(args); return new Promise(resolve => {release = resolve;});});
  const old = new EmployeePages(loader, 'w', 'old-project'); const loading = old.refresh(); old.dispose(); release(first); await loading;
  expect(old.getSnapshot().rows).toHaveLength(0); expect(calls).toEqual([['w', 'old-project', undefined]]);
  const freshCalls: unknown[][] = [];
  const fresh = new EmployeePages(api(async (...args) => {freshCalls.push(args); return args[2] ? last : first;}), 'w', 'new-project');
  await fresh.refresh(); await fresh.more(); expect(freshCalls).toEqual([['w', 'new-project', undefined], ['w', 'new-project', first.nextCursor]]);
});
test('invalid cursor loops and foreign-space rows fail closed', async () => {
  expect(() => validateEmployeePage({...first, nextCursor: 'same'}, 'w', 'same')).toThrow();
  expect(() => validateEmployeePage({...last, items: [{...employee(101), workspaceId: 'other'}]}, 'w')).toThrow();
  expect(() => validateEmployeePage({...last, hasMore: true}, 'w')).toThrow();
  const pages = new EmployeePages(api(async () => {throw {code: 403};}), 'w'); await pages.refresh();
  expect(pages.getSnapshot()).toMatchObject({rows: [], ready: false, hasMore: false, error: true});
});
test('repeated load-more clicks serialize to one page request', async () => {
  let release!: (page: WorkspaceEmployeePage) => void;
  let count = 0;
  const pages = new EmployeePages(api(async (_, __, cursor) => {count++; return cursor ? new Promise(resolve => {release = resolve;}) : first;}), 'w');
  await pages.refresh(); const pending = pages.more(); await pages.more(); release(last); await pending;
  expect(count).toBe(2); expect(pages.getSnapshot().rows).toHaveLength(101);
});
for (const [machineCode, errorCode] of [['WORKSPACE_EMPLOYEE_PAGE_REQUIRED', 'pageRequired'], ['WORKSPACE_CATALOG_LIMIT_EXCEEDED', 'catalogLimit']]) test(`explicit ${machineCode} is not an empty successful list`, async () => {
  const pages = new EmployeePages(api(async () => {throw {machineCode};}), 'w'); await pages.refresh();
  expect(pages.getSnapshot()).toMatchObject({ready: false, error: true, errorCode});
});
