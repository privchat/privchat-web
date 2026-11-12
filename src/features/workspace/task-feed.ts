import type { WorkspaceActivity, TaskFeedPage } from './api';

export function historical(row: WorkspaceActivity) {
  return row.item.status === 'done' || row.item.status === 'cancelled';
}
/** Keep server activity order; execution outcome never closes business work. */
export function unfinishedTaskFeed(rows: WorkspaceActivity[]) {
  return rows.filter(row => !historical(row));
}
export function mergeActivityPage(current: WorkspaceActivity[], incoming: WorkspaceActivity[]) {
  const rows = new Map(current.map(row => [row.item.id, row]));
  for (const row of incoming) {
    const old = rows.get(row.item.id);
    if (!old || row.item.version >= old.item.version) rows.set(row.item.id, row);
  }
  return [...rows.values()];
}
export function validateTaskFeed(page: TaskFeedPage, workspaceId?: string, projectId?: string, cursor?: string, unprojected = false) {
  if (!page || !Array.isArray(page.items) || typeof page.hasOlder !== 'boolean'
    || !(page.olderCursor === null || typeof page.olderCursor === 'string')
    || (page.hasOlder && (!page.olderCursor || page.olderCursor === cursor))
    || page.items.some(row => !row?.item || (workspaceId && row.item.workspaceId !== workspaceId) || (projectId && row.item.projectId !== projectId) || (unprojected && row.item.projectId))) {
    throw new Error('Invalid scoped task feed');
  }
  return page;
}
