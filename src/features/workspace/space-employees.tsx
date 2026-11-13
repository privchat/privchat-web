import { useEffect, useState, type ReactNode } from 'react';
import { Bot, Plus } from 'lucide-react';
import {TaskHistory} from './task-history';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Employee, Node, Workspace, WorkspaceApi } from './api';
import { availableEmployeeExecutors, employeeExecutor } from './employees';
import { usePageLabels } from './page-labels';
import { StatusPill, WsPageHeader, WsTable, WsTd, WsTh, wsField } from './shell';
import { useEmployeePages } from './use-employee-pages';

const executorDisplay = (value: string) => value === 'codex' ? 'Codex' : value === 'claude' ? 'Claude Code' : value || '—';

export function SpaceEmployees({api, workspaceId, onLockChange, renderSession}: {api: WorkspaceApi; renderSession?: (id: string) => ReactNode; workspaceId: string; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [history, setHistory] = useState<string>();
  const employeePages = useEmployeePages(api, workspaceId);
  const rows = employeePages.rows;
  const [space, setSpace] = useState<Workspace | null>(null);
  const [owned, setOwned] = useState<Employee[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [employee, setEmployee] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
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
    <WsPageHeader title={l('employeesTitle')} subtitle={l('employeesSub')} actions={
      <Button disabled={readOnly || busy} onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{l('addEmployee')}</Button>
    } />
    {space && readOnly && <p className="mb-3 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm text-muted-foreground">{l('readOnly')}</p>}
    {(error || employeePages.error) && <p role="alert" className="mb-3 text-sm text-destructive">{l(employeePages.errorCode ?? 'error')}</p>}
    {rows.length > 0 && <WsTable head={<><WsTh>{l('colEmployee')}</WsTh><WsTh>{l('colExecutor')}</WsTh><WsTh>{l('colDevice')}</WsTh><WsTh>{l('colWorkdir')}</WsTh><WsTh>{l('colStatus')}</WsTh><WsTh /></>}>
      {rows.map(row => <tr key={row.id}>
        <WsTd>{row.name ?? row.employeeId}</WsTd>
        <WsTd className="text-muted-foreground">{executorDisplay(employeeExecutor(row.capability ?? '') ?? row.capability ?? '')}</WsTd>
        <WsTd className="text-muted-foreground">{nodes.find(n => n.nodeId === row.nodeId)?.name ?? row.nodeId ?? '—'}</WsTd>
        <WsTd className="text-muted-foreground">{nodes.find(n => n.nodeId === row.nodeId)?.workdirs?.find(w => w.id === row.workdirBindingId)?.label ?? row.workdirBindingId ?? l('unavailable')}</WsTd>
        <WsTd><StatusPill><span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', row.available ? 'bg-current' : 'border border-current')} />{row.available ? l('available') : `${l('busy')}: ${row.unavailableReason ?? l('unavailable')}`}</StatusPill></WsTd>
        <WsTd><div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setHistory(row.employeeId)}>{l('taskRecords')}</Button>
          <Button variant="ghost" size="sm" disabled={readOnly || busy} onClick={() => void act(() => api.removeEmployeeAssociation(row.id))}>{l('unlink')}</Button>
        </div></WsTd>
      </tr>)}
    </WsTable>}
    {!rows.length && <div className="rounded-[9px] border py-[58px] text-center text-muted-foreground">
      <Bot className="mx-auto h-6 w-6" aria-hidden="true" />
      <p className="mt-2 text-sm">{l('empty')}</p>
    </div>}
    {employeePages.hasMore && <div className="mt-3"><Button variant="outline" disabled={busy || employeePages.busy} onClick={() => void employeePages.more()}>{l('more')}</Button></div>}
    <div className="mt-[22px] rounded-[9px] border bg-card p-4">
      <label className="grid max-w-sm gap-1.5 text-sm font-medium">{l('link')}
        <select className={wsField} value={employee} disabled={readOnly || busy} onChange={e => setEmployee(e.target.value)}><option value="">{l('none')}</option>{owned.filter(e => !rows.some(r => r.employeeId === e.agentId)).map(e => <option key={e.agentId} value={e.agentId}>{e.name}</option>)}</select>
      </label>
      <div className="mt-3"><Button disabled={readOnly || busy || !employee} onClick={() => void act(async () => {await api.associateEmployee(workspaceId, employee); setEmployee('');})}>{l('link')}</Button></div>
    </div>
    <AddEmployeeDialog api={api} nodes={nodes} workspaceId={workspaceId} open={adding} onClose={() => setAdding(false)} onCreated={() => {setAdding(false); void reload();}} onLockChange={onLockChange}/>
  </section>;
}

function AddEmployeeDialog({api, nodes, workspaceId, open, onClose, onCreated, onLockChange}: {api: WorkspaceApi; nodes: Node[]; workspaceId: string; open: boolean; onClose: () => void; onCreated: () => void; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [name, setName] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [executor, setExecutor] = useState('');
  const [workdirBindingId, setWorkdirBindingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const node = nodes.find(n => n.nodeId === nodeId);
  const executors = availableEmployeeExecutors(node);
  const valid = !!name.trim() && !!nodeId && !!executor && !!workdirBindingId;
  function reset() {setName(''); setNodeId(''); setExecutor(''); setWorkdirBindingId(''); setError(false);}
  function close() {if (busy) return; reset(); onClose();}
  async function submit() {
    if (busy || !valid) return;
    setBusy(true); setError(false); onLockChange(true);
    try {
      const created = await api.createEmployee({requestId: crypto.randomUUID(), name: name.trim(), nodeId, executor, workdirBindingId, title: '', roleDescription: '', model: ''});
      await api.associateEmployee(workspaceId, created.agentId);
      reset(); onCreated();
    } catch {setError(true);}
    finally {setBusy(false); onLockChange(false);}
  }
  return <Dialog open={open} onOpenChange={o => {if (!o) close();}}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{l('addEmployee')}</DialogTitle>
        <DialogDescription>{l('addEmployeeHint')}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={e => {e.preventDefault(); void submit();}}>
        <label className="grid gap-1.5 text-sm font-medium">{l('employeeNameLabel')}
          <input className={wsField} value={name} disabled={busy} onChange={e => setName(e.target.value)}/>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">{l('deviceNodeLabel')}
          <select className={wsField} value={nodeId} disabled={busy} onChange={e => {setNodeId(e.target.value); setExecutor(''); setWorkdirBindingId('');}}>
            <option value="">{l('deviceNodeLabel')}</option>
            {nodes.map(n => <option key={n.nodeId} value={n.nodeId} disabled={n.state !== 'active'}>{n.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">{l('executorLabel')}
          <select className={wsField} value={executor} disabled={busy || !nodeId} onChange={e => setExecutor(e.target.value)}>
            <option value="">{l('executorLabel')}</option>
            {executors.map(e => <option key={e} value={e}>{executorDisplay(e)}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">{l('workdirLabel')}
          <select className={wsField} value={workdirBindingId} disabled={busy || !nodeId} onChange={e => setWorkdirBindingId(e.target.value)}>
            <option value="">{l('workdirLabel')}</option>
            {node?.workdirs?.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{l('error')}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={close}>{l('cancel')}</Button>
          <Button type="submit" disabled={busy || !valid}>{l('createEmployeeBtn')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
