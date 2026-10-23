import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { WorkspaceApi, ArchivedNodeEvent } from './api';
import { useReadPage } from './read-page';
import { publicRecords, validateSessionRecordsPage } from './public-records';

export function SessionRecords({api, executionId, onDenied}: {api: WorkspaceApi; executionId: string; onDenied: () => void}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const load = useCallback(async (cursor?: string) => {
    const page = await api.records(executionId, cursor);
    return validateSessionRecordsPage(page, executionId, cursor);
  }, [api, executionId]);
  const records = useReadPage(load, (event: ArchivedNodeEvent) => String(event.seq));
  useEffect(() => { if (records.status === 'denied') onDenied(); }, [records.status, onDenied]);
  return <section data-testid="session-records" className="min-w-0 space-y-3 rounded border p-3">
    <h3 className="font-semibold">{label('archivedRecords')}</h3>
    <p className="text-sm text-muted-foreground">{label('archiveCoverage')}</p>
    {records.page && <p>{label('lastArchivedSeq')}: {records.page.lastArchivedSeq}</p>}
    {records.gap && <p role="status">{label('archiveGap')}</p>}
    {records.status !== 'ready' && <p role="alert">{label(records.status === 'unsupported' ? 'archiveUnsupported' : records.status)}</p>}
    {records.status === 'ready' && !records.rows.length && <p>{label('archiveEmpty')}</p>}
    <ol className="space-y-2">{records.rows.map(event => <li key={event.seq} data-testid="archived-event" className="min-w-0">
      {publicRecords(event).map((record, index) => <div key={index} className="rounded border p-2">
        <p className="text-xs text-muted-foreground">#{event.seq} · {label(`record_${record.kind}`)}</p>
        {record.state && <p>{label(`execution_${record.state}`)}</p>}
        {record.text && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{record.text}</p>}
        {record.kind === 'gap' && <p>{label('archiveGap')}</p>}
        {record.kind.startsWith('permission_') && <p className="text-sm text-muted-foreground">{label('record_permission_hint')}</p>}
      </div>)}
    </li>)}</ol>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={records.busy || records.status === 'denied'} onClick={() => void records.refresh()}>{label('refresh')}</Button>
      {records.page?.nextCursor && <Button disabled={records.busy || records.status === 'denied'} onClick={() => void records.more()}>{label('more')}</Button>}
    </div>
  </section>;
}
