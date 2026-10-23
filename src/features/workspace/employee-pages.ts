import type { WorkspaceApi, WorkspaceEmployee, WorkspaceEmployeePage } from './api';
import { roomFailure } from './room-observer';

export interface EmployeePageState {
  rows: WorkspaceEmployee[]; nextCursor: string | null; hasMore: boolean;
  ready: boolean; busy: boolean; error: boolean;
  errorCode?: 'pageRequired' | 'catalogLimit';
}

export function validateEmployeePage(page: WorkspaceEmployeePage, workspaceId: string, cursor?: string) {
  if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean'
    || !(page.nextCursor === null || typeof page.nextCursor === 'string')
    || (page.hasMore && (!page.nextCursor || page.nextCursor === cursor))
    || (!page.hasMore && page.nextCursor !== null)
    || page.items.some(row => !row || row.workspaceId !== workspaceId || !row.id || !row.employeeId || typeof row.available !== 'boolean')) {
    throw new Error('Invalid scoped employee page');
  }
  return page;
}
function merge(rows: WorkspaceEmployee[], items: WorkspaceEmployee[]) {
  const result = new Map(rows.map(row => [row.id, row]));
  for (const row of items) result.set(row.id, row);
  return [...result.values()];
}
/** Cursors follow references, never the locally filtered available subset. */
export class EmployeePages {
  private state: EmployeePageState = {rows: [], nextCursor: null, hasMore: false, ready: false, busy: false, error: false};
  private listeners = new Set<() => void>();
  private generation = 0;
  private loadedPages = 0;
  constructor(private api: Pick<WorkspaceApi, 'employeePage'>, private workspaceId: string, private projectId?: string) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private publish(state: EmployeePageState) {this.state = state; for (const listener of this.listeners) listener();}
  dispose() {this.generation++; this.state = {...this.state, busy: false};}
  more = async () => {
    if (this.state.busy || !this.state.ready || !this.state.hasMore) return;
    await this.read(false);
  };
  refresh = async () => {
    if (this.state.busy) return;
    await this.read(true);
  };
  private async read(refresh: boolean) {
    const generation = ++this.generation;
    const previous = this.state;
    const count = refresh ? Math.max(1, this.loadedPages) : 1;
    this.publish({...previous, busy: true, error: false, errorCode: undefined});
    try {
      let cursor = refresh ? undefined : previous.nextCursor ?? undefined;
      let rows = refresh ? [] : previous.rows;
      let page!: WorkspaceEmployeePage;
      let pagesRead = 0;
      const seen = new Set<string>();
      for (let index = 0; index < count; index++) {
        if (cursor) {if (seen.has(cursor)) throw new Error('Repeated employee cursor'); seen.add(cursor);}
        page = validateEmployeePage(await this.api.employeePage(this.workspaceId, this.projectId, cursor), this.workspaceId, cursor);
        if (generation !== this.generation) return;
        rows = merge(rows, page.items); pagesRead++;
        if (!page.hasMore) break;
        cursor = page.nextCursor!;
      }
      this.loadedPages = refresh ? pagesRead : this.loadedPages + pagesRead;
      this.publish({rows, nextCursor: page.nextCursor, hasMore: page.hasMore, ready: true, busy: false, error: false});
    } catch (error) {
      if (generation !== this.generation) return;
      if (roomFailure(error) === 'denied') {this.loadedPages = 0; this.publish({rows: [], nextCursor: null, hasMore: false, ready: false, busy: false, error: true});}
      else {
        const code = (error as {machineCode?: string})?.machineCode;
        const errorCode = code === 'WORKSPACE_EMPLOYEE_PAGE_REQUIRED' ? 'pageRequired' : code === 'WORKSPACE_CATALOG_LIMIT_EXCEEDED' ? 'catalogLimit' : undefined;
        this.publish({...previous, busy: false, error: true, errorCode});
      }
    }
  }
}
