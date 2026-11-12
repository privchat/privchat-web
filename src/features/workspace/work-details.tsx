import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Button} from '@/components/ui/button';
import type {Binding, Node, WorkNote, WorkspaceActivity, WorkspaceApi} from './api';
import {usePageLabels} from './page-labels';
import {StatusPill} from './shell';
import {WorkItemPanel} from './work-item';
import {WorkflowPanel} from './workflow';

export function WorkDetails({api, row, readOnly, onBack, renderSession, onLockChange}: {api: WorkspaceApi; row: WorkspaceActivity; readOnly: boolean; onBack: () => void; renderSession: (id: string) => ReactNode; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const [item, setItem] = useState(row.item);
  const [notes, setNotes] = useState<WorkNote[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [execution, setExecution] = useState(row.latestExecution?.executionId ?? '');
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState(false);
  const live = useRef(true);
  async function refresh() {
    const [current, n, b, w] = await Promise.all([api.item(item.id), api.nodes(), api.bindings(item.workspaceId), api.get<WorkNote[]>(`/workspace/work-note/list?workItemId=${encodeURIComponent(item.id)}`)]);
    if (!live.current) return;
    if (!current || current.id !== item.id || current.workspaceId !== item.workspaceId) throw new Error('Work item unavailable');
    setItem(current); setNotes(w); setNodes(n); setBindings(b);
  }
  useEffect(() => {live.current = true; void refresh().catch(() => {if (live.current) setError(true);}); return () => {live.current = false;};}, [api, item.id]);
  return <section className="w-full min-w-0">
    <div className="mb-[23px] flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" disabled={locked} onClick={onBack}>{l('back')}</Button>
      <StatusPill><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{label(`status_${item.status}`)}</StatusPill>
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{l('error')}</p>}
    <div className="grid gap-[22px] lg:grid-cols-[minmax(0,1fr)_245px]">
      <div className="min-w-0 space-y-[22px]">
        <WorkItemPanel api={api} item={item} notes={notes} readOnly={readOnly || error} refresh={refresh}/>
        <WorkflowPanel api={api} item={item} nodes={nodes} bindings={bindings} notes={notes} readOnly={readOnly || error} onLockChange={value => {setLocked(value); onLockChange(value);}} onExecution={setExecution}/>
        {execution && renderSession(execution)}
      </div>
      <aside className="min-w-0">
        <div className="rounded-[9px] border bg-card p-4">
          <h2 className="text-[17px] font-semibold">{l('taskInfo')}</h2>
          <div className="mt-3.5 grid gap-3 text-sm">
            <div className="flex justify-between gap-2.5"><span className="text-muted-foreground">{label('itemStatus')}</span><span>{label(`status_${item.status}`)}</span></div>
            <div className="flex justify-between gap-2.5"><span className="text-muted-foreground">v</span><span>{item.version}</span></div>
            <div className="flex justify-between gap-2.5"><span className="text-muted-foreground">{label('executionCount')}</span><span>{row.executionCount}</span></div>
            <div className="flex justify-between gap-2.5"><span className="text-muted-foreground">{label('latestExecution')}</span><span className="text-right">{row.latestExecution?.state ?? label('notExecuted')}</span></div>
          </div>
        </div>
      </aside>
    </div>
  </section>;
}
