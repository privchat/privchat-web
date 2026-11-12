import { useEffect, useState, type ReactNode } from 'react';
import { Bot, Plus } from 'lucide-react';
import {TaskHistory} from './task-history';
import { Button } from '@/components/ui/button';
import type { Employee, Node, Workspace, WorkspaceApi } from './api';
import { EmployeePanel } from './employees';
import { usePageLabels } from './page-labels';
import { StatusPill, WsPageHeader, wsField } from './shell';
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
  return <section data-testid="space-employees" className="w-full min-w-0">
    <WsPageHeader title={l('employeesTitle')} subtitle={l('employeesSub')} actions={<>
      <Button variant="ghost" disabled={busy || locked} onClick={onBack}>{l('back')}</Button>
      <Button variant="outline" disabled={busy || locked} onClick={() => void act(async () => {})}>{l('reload')}</Button>
      <Button disabled={readOnly || busy || locked} onClick={() => setConfigure(true)}><Plus className="h-4 w-4" />{l('addEmployee')}</Button>
    </>} />
    {space && readOnly && <p className="mb-3 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm text-muted-foreground">{l('readOnly')}</p>}
    {(error || employeePages.error) && <p role="alert" className="mb-3 text-sm text-destructive">{l(employeePages.errorCode ?? 'error')}</p>}
    {rows.length > 0 && <div className="divide-y rounded-[9px] border">
      {rows.map(row => <article key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-[15px] py-[13px]">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-medium">{row.name ?? row.employeeId}</h3>
          <p className="text-sm text-muted-foreground">{nodes.find(n => n.nodeId === row.nodeId)?.name ?? row.nodeId} · {row.capability}</p>
          <p className="text-sm text-muted-foreground">{nodes.find(n => n.nodeId === row.nodeId)?.workdirs?.find(w => w.id === row.workdirBindingId)?.label ?? l('unavailable')}</p>
          <p className="text-xs text-muted-foreground">{l('sessionUnknown')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusPill><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{row.available ? l('available') : `${l('busy')}: ${row.unavailableReason ?? l('unavailable')}`}</StatusPill>
          <Button variant="outline" size="sm" disabled={busy || locked} onClick={() => setHistory(row.employeeId)}>{l('taskRecords')}</Button>
          <Button variant="ghost" size="sm" disabled={readOnly || busy || locked} onClick={() => void act(() => api.removeEmployeeAssociation(row.id))}>{l('unlink')}</Button>
        </div>
      </article>)}
    </div>}
    {!rows.length && <div className="rounded-[9px] border py-[58px] text-center text-muted-foreground">
      <Bot className="mx-auto h-6 w-6" aria-hidden="true" />
      <p className="mt-2 text-sm">{l('empty')}</p>
    </div>}
    {employeePages.hasMore && <div className="mt-3"><Button variant="outline" disabled={busy || locked || employeePages.busy} onClick={() => void employeePages.more()}>{l('more')}</Button></div>}
    <div className="mt-[22px] rounded-[9px] border bg-card p-4">
      <label className="grid max-w-sm gap-1.5 text-sm font-medium">{l('link')}
        <select className={wsField} value={employee} disabled={readOnly || busy || locked} onChange={e => setEmployee(e.target.value)}><option value="">{l('none')}</option>{owned.filter(e => !rows.some(r => r.employeeId === e.agentId)).map(e => <option key={e.agentId} value={e.agentId}>{e.name}</option>)}</select>
      </label>
      <div className="mt-3"><Button disabled={readOnly || busy || locked || !employee} onClick={() => void act(async () => {await api.associateEmployee(workspaceId, employee); setEmployee('');})}>{l('link')}</Button></div>
    </div>
    {configure && <EmployeePanel workspaceMode api={api} nodes={nodes} refreshNodes={reload} renderSession={() => null} onRequestLockChange={value => {setLocked(value); onLockChange(value);}}/>}
  </section>;
}
