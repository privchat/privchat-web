import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import type {Binding, Node, WorkNote, WorkspaceActivity, WorkspaceApi} from './api';
import {usePageLabels} from './page-labels';
import {WorkItemPanel} from './work-item';
import {WorkflowPanel} from './workflow';

export function WorkDetails({api, row, readOnly, onBack, renderSession, onLockChange}: {api: WorkspaceApi; row: WorkspaceActivity; readOnly: boolean; onBack: () => void; renderSession: (id: string) => ReactNode; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
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
  return <section className="space-y-3"><Button variant="ghost" disabled={locked} onClick={onBack}>{l('back')}</Button>{error && <p role="alert">{l('error')}</p>}
    <WorkItemPanel api={api} item={item} notes={notes} readOnly={readOnly || error} refresh={refresh}/>
    <WorkflowPanel api={api} item={item} nodes={nodes} bindings={bindings} notes={notes} readOnly={readOnly || error} onLockChange={value => {setLocked(value); onLockChange(value);}} onExecution={setExecution}/>
    {execution && renderSession(execution)}
  </section>;
}
