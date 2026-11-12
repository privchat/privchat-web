import { useEffect, useState, type ReactNode } from 'react';
import {TaskHistory} from './task-history';
import { Button } from '@/components/ui/button';
import type { Employee, Node, Workspace, WorkspaceApi } from './api';
import { EmployeePanel } from './employees';
import { usePageLabels } from './page-labels';
import { workspaceField } from './project-management';
import { useEmployeePages } from './use-employee-pages';

export function SpaceEmployees({api, workspaceId, onBack, onLockChange, renderSession}: {api: WorkspaceApi; renderSession?: (id: string) => ReactNode; workspaceId: string; onBack: () => void; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [history, setHistory] = useState<string>();
  const employeePages = useEmployeePages(api, workspaceId);
  const rows = employeePages.rows;
  const [space, setSpace] = useState<Workspace | null>(null);
  const [owned, setOwned] = useState<Employee[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [employee, setEmployee] = useState('');
  const [configure, setConfigure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState(false);
  const readOnly = !space || space.archived !== 0 || !['owner', 'admin', 'member'].includes(space.myRole);
  async function reload() {
    const [, e, n] = await Promise.all([employeePages.refresh(), api.employees(), api.nodes()]);
    setOwned(e); setNodes(n);
  }
  useEffect(() => {let live = true; void Promise.all([api.space(workspaceId), api.employees(), api.nodes()]).then(([s,e,n]) => {if (live) {setSpace(s); setOwned(e); setNodes(n);}}).catch(() => {if (live) setError(true);}); return () => {live = false;};}, [api, workspaceId]);
  async function act(action: () => Promise<unknown>) {if (busy) return; setBusy(true); setError(false); try {await action(); await reload();} catch {setError(true);} finally {setBusy(false);}}
  if (history) return <TaskHistory api={api} scope={{employeeId: history}} renderSession={renderSession} onBack={() => setHistory(undefined)}/>;
  return <section data-testid="space-employees" className="space-y-3">
    <header className="flex justify-between gap-2"><Button variant="ghost" disabled={busy || locked} onClick={onBack}>{l('back')}</Button><h2>{l('manageEmployees')}</h2><Button disabled={readOnly || busy || locked} onClick={() => setConfigure(true)}>{l('create')}</Button></header>
    {space && readOnly && <p>{l('readOnly')}</p>}
    {(error || employeePages.error) && <p role="alert">{l(employeePages.errorCode ?? 'error')}</p>}
    <Button disabled={busy || locked} variant="outline" onClick={() => void act(async () => {})}>{l('reload')}</Button>
    {rows.map(row => <article key={row.id} className="space-y-1 rounded border p-3"><h3>{row.name ?? row.employeeId}</h3><Button variant="outline" disabled={busy || locked} onClick={() => setHistory(row.employeeId)}>{l('taskRecords')}</Button><p>{nodes.find(n => n.nodeId === row.nodeId)?.name ?? row.nodeId} · {row.capability}</p><p>{nodes.find(n => n.nodeId === row.nodeId)?.workdirs?.find(w => w.id === row.workdirBindingId)?.label ?? l('unavailable')}</p><p>{row.available ? l('available') : `${l('busy')}: ${row.unavailableReason ?? l('unavailable')}`}</p><p>{l('sessionUnknown')}</p><Button variant="outline" disabled={readOnly || busy || locked} onClick={() => void act(() => api.removeEmployeeAssociation(row.id))}>{l('unlink')}</Button></article>)}
    {!rows.length && <p>{l('empty')}</p>}
    {employeePages.hasMore && <Button disabled={busy || locked || employeePages.busy} onClick={() => void employeePages.more()}>{l('more')}</Button>}
    <label>{l('link')}<select className={workspaceField} value={employee} disabled={readOnly || busy || locked} onChange={e => setEmployee(e.target.value)}><option value="">{l('none')}</option>{owned.filter(e => !rows.some(r => r.employeeId === e.agentId)).map(e => <option key={e.agentId} value={e.agentId}>{e.name}</option>)}</select></label>
    <Button disabled={readOnly || busy || locked || !employee} onClick={() => void act(async () => {await api.associateEmployee(workspaceId, employee); setEmployee('');})}>{l('link')}</Button>
    {configure && <EmployeePanel workspaceMode api={api} nodes={nodes} refreshNodes={reload} renderSession={() => null} onRequestLockChange={value => {setLocked(value); onLockChange(value);}}/>}
  </section>;
}
