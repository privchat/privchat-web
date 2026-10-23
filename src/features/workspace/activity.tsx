import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { WorkspaceApi, WorkspaceActivity } from './api';
import { useReadPage } from './read-page';
import { executionStates, itemStates } from './public-records';

export function WorkspaceActivityList({api, workspaceId, onOpen, onDenied}: {api: WorkspaceApi; workspaceId: string; onOpen: (row: WorkspaceActivity) => void; onDenied: () => void}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const load = useCallback(async (cursor?: string) => {
    const page = await api.activity(workspaceId, cursor);
    if (!page || !Array.isArray(page.items) || !(page.nextCursor === null || typeof page.nextCursor === 'string') || page.items.some(row => !row.item || row.item.workspaceId !== workspaceId)) throw new Error('Invalid activity page');
    return page;
  }, [api, workspaceId]);
  const feed = useReadPage(load, (row: WorkspaceActivity) => row.item.id);
  useEffect(() => { if (feed.status === 'denied') onDenied(); }, [feed.status, onDenied]);
  return <section data-testid="workspace-activity" className="min-w-0 space-y-3 rounded border p-3">
    <h3 className="font-semibold">{label('activity')}</h3>
    <p className="text-sm text-muted-foreground">{label('activityHint')}</p>
    {feed.status !== 'ready' && <p role="alert">{label(feed.status === 'unsupported' ? 'activityUnsupported' : feed.status)}</p>}
    {feed.status === 'ready' && !feed.rows.length && <p>{label('empty')}</p>}
    {feed.rows.map(row => <article key={row.item.id} data-testid="activity-item" className="min-w-0 space-y-2 rounded border p-3">
      <h4 className="break-words font-medium">{row.item.title}</h4>
      {row.item.projectId && <p>{label('project')}: {row.item.projectId}</p>}
      <p>{label('itemStatus')}: {label(itemStates.includes(row.item.status) ? `status_${row.item.status}` : 'unknown')}</p>
      <p>{label('latestExecution')}: {row.latestExecution ? label(executionStates.includes(row.latestExecution.state ?? '') ? `execution_${row.latestExecution.state}` : 'execution_unknown') : label('notExecuted')}</p>
      {row.latestExecution?.employeeId && <p>{label('employees')}: {row.latestExecution.employeeId}</p>}
      <p>{label('executionCount')}: {row.executionCount}</p>
      <p className="text-sm text-muted-foreground">{label(['succeeded', 'failed', 'cancelled'].includes(row.latestExecution?.state ?? '') ? 'executionDetailsHint' : 'noFinalResult')}</p>
      <Button variant="outline" disabled={feed.status === 'denied'} onClick={() => onOpen(row)}>{label('openWorkDetails')}</Button>
    </article>)}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={feed.busy || feed.status === 'denied'} onClick={() => void feed.refresh()}>{label('refresh')}</Button>
      {feed.page?.nextCursor && <Button disabled={feed.busy || feed.status === 'denied'} onClick={() => void feed.more()}>{label('more')}</Button>}
    </div>
  </section>;
}
