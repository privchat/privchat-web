import { useEffect, useState, type ReactNode } from 'react';
import { Bot, Circle, LoaderCircle, Plus } from 'lucide-react';
import {TaskHistory} from './task-history';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Binding, Employee, Node, Workspace, WorkspaceApi, WorkspaceEmployee } from './api';
import { availableEmployeeExecutors, employeeExecutor, executorDisplay } from './employees';
import { employeeCause, executorGrant, grantableWorkspaceBinding, workspaceBindingGrant } from './employee-access';
import { employeeReasonLabel, usePageLabels } from './page-labels';
import { navigateWorkspace } from './routes';
import { StatusPill, WsPageHeader, WsTable, WsTd, WsTh, wsField } from './shell';
import { useEmployeePages } from './use-employee-pages';

export function SpaceEmployees({api, workspaceId, onLockChange, renderSession}: {api: WorkspaceApi; renderSession?: (id: string) => ReactNode; workspaceId: string; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [history, setHistory] = useState<string>();
  const employeePages = useEmployeePages(api, workspaceId);
  const rows = employeePages.rows;
  const [space, setSpace] = useState<Workspace | null>(null);
  const [owned, setOwned] = useState<Employee[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [adding, setAdding] = useState(false);
  const [manageId, setManageId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const readOnly = !space || space.archived !== 0 || !['owner', 'admin', 'member'].includes(space.myRole);
  const managed = rows.find(r => r.id === manageId);
  const managedCause = managed ? employeeCause(managed, bindings, nodes) : undefined;
  const managedGrant = managed ? grantableWorkspaceBinding(managed, bindings, nodes) : null;
  const managedOwn = !!managed && owned.some(e => e.agentId === managed.employeeId);
  const candidates = owned.filter(e => !rows.some(r => r.employeeId === e.agentId));
  // Short states stay pills; a long localized reason wraps instead of stretching the table (§18.8).
  const status = (row: WorkspaceEmployee) => {
    const cause = employeeCause(row, bindings, nodes);
    if (!cause) return {icon: Circle, text: l('idle'), pill: true};
    if (cause === 'busy') return {icon: LoaderCircle, text: l('statusRunning'), pill: true};
    if (cause === 'offline') return {icon: Circle, text: l('deviceOffline'), pill: true};
    return {icon: Circle, text: l(employeeReasonLabel[cause]), pill: false};
  };
  async function reload() {
    const [, e, n, b] = await Promise.all([employeePages.refresh(), api.employees(), api.nodes(), api.bindings(workspaceId)]);
    setOwned(e); setNodes(n); setBindings(b);
  }
  useEffect(() => {let live = true; void Promise.all([api.space(workspaceId), api.employees(), api.nodes(), api.bindings(workspaceId)]).then(([s,e,n,b]) => {if (live) {setSpace(s); setOwned(e); setNodes(n); setBindings(b);}}).catch(() => {if (live) setError(true);}); return () => {live = false;};}, [api, workspaceId]);
  async function act(action: () => Promise<unknown>) {if (busy) return; setBusy(true); setError(false); try {await action(); await reload();} catch {setError(true);} finally {setBusy(false);}}
  if (history) return <TaskHistory api={api} scope={{employeeId: history}} renderSession={renderSession} onBack={() => setHistory(undefined)}/>;
  return <section data-testid="space-employees" className="w-full min-w-0">
    <WsPageHeader title={l('employeesTitle')} subtitle={l('employeesSub')} actions={
      <Button disabled={readOnly || busy} onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{l('addEmployee')}</Button>
    } />
    {space && readOnly && <p className="mb-3 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm text-muted-foreground">{l('readOnly')}</p>}
    {(error || employeePages.error) && <p role="alert" className="mb-3 text-sm text-destructive">{l(employeePages.errorCode ?? 'error')}</p>}
    {managed && <section className="mb-3 space-y-3 rounded border p-3" aria-label={l('manage')}>
      <h3 className="font-semibold">{managed.name || l('unnamedEmployee')}</h3>
      {managedCause && <p className="text-sm text-muted-foreground" data-testid="employee-unavailable">{l(employeeReasonLabel[managedCause])}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => navigateWorkspace({view: 'employee', spaceId: workspaceId, employeeId: managed.employeeId})}>{l('shellDetail')}</Button>
        {!readOnly && managedOwn && <Button variant="outline" size="sm" disabled={busy} onClick={() => navigateWorkspace({view: 'employee', spaceId: workspaceId, employeeId: managed.employeeId, panel: 'profile'})}>{l('editProfile')}</Button>}
        {!readOnly && managedOwn && <Button variant="outline" size="sm" disabled={busy} onClick={() => navigateWorkspace({view: 'employee', spaceId: workspaceId, employeeId: managed.employeeId, panel: 'rebind'})}>{l('rebindAction')}</Button>}
        {!readOnly && managedGrant && <Button size="sm" disabled={busy} onClick={() => void act(async () => {await api.createBinding(workspaceId, managedGrant.nodeId, managedGrant.capability);})}>{l('authorizeWorkspace')}</Button>}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setHistory(managed.employeeId)}>{l('taskRecords')}</Button>
        {!readOnly && <Button variant="destructive" size="sm" disabled={busy} onClick={() => void act(async () => {await api.removeEmployeeAssociation(managed.id); setManageId(undefined);})}>{l('unlink')}</Button>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setManageId(undefined)}>{l('cancel')}</Button>
      </div>
      {!readOnly && managedGrant && <p className="text-sm text-muted-foreground">{l('authorizeWorkspaceHint')}</p>}
    </section>}
    {rows.length > 0 && <WsTable head={<><WsTh>{l('colEmployee')}</WsTh><WsTh>{l('colExecutor')}</WsTh><WsTh>{l('colDevice')}</WsTh><WsTh>{l('colWorkdir')}</WsTh><WsTh>{l('colStatus')}</WsTh></>}>
      {rows.map(row => {const s = status(row); return <tr key={row.id} className="hover:bg-accent/40">
        <WsTd><button type="button" className="font-semibold hover:underline focus-visible:underline" onClick={() => setManageId(row.id)}>{row.name || l('unnamedEmployee')}</button></WsTd>
        <WsTd>{executorDisplay(employeeExecutor(row.capability ?? '') ?? row.capability ?? '')}</WsTd>
        <WsTd>{nodes.find(n => n.nodeId === row.nodeId)?.name ?? row.nodeId ?? '—'}</WsTd>
        <WsTd>{nodes.find(n => n.nodeId === row.nodeId)?.workdirs?.find(w => w.id === row.workdirBindingId)?.label ?? row.workdirBindingId ?? l('unavailable')}</WsTd>
        <WsTd>{s.pill ? <StatusPill icon={s.icon}>{s.text}</StatusPill> : <span className="block max-w-[300px] text-xs text-muted-foreground">{s.text}</span>}</WsTd>
      </tr>;})}
    </WsTable>}
    {!rows.length && <div className="rounded-[9px] border py-[58px] text-center text-muted-foreground">
      <Bot className="mx-auto h-6 w-6" aria-hidden="true" />
      <p className="mt-2 text-sm">{l('noLinkedEmployees')}</p>
    </div>}
    {employeePages.hasMore && <div className="mt-3"><Button variant="outline" disabled={busy || employeePages.busy} onClick={() => void employeePages.more()}>{l('more')}</Button></div>}
    <AddEmployeeDialog api={api} nodes={nodes} bindings={bindings} workspaceId={workspaceId} candidates={candidates} readOnly={readOnly} open={adding} onClose={() => setAdding(false)} onCreated={() => {setAdding(false); void reload();}} onAssociated={() => void reload()} onLockChange={onLockChange}/>
  </section>;
}

function AddEmployeeDialog({api, nodes, bindings, workspaceId, candidates, readOnly, open, onClose, onCreated, onAssociated, onLockChange}: {api: WorkspaceApi; nodes: Node[]; bindings: Binding[]; workspaceId: string; candidates: Employee[]; readOnly: boolean; open: boolean; onClose: () => void; onCreated: () => void; onAssociated: () => void; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [name, setName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [title, setTitle] = useState('');
  const [model, setModel] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [executor, setExecutor] = useState('');
  const [workdirBindingId, setWorkdirBindingId] = useState('');
  const [associateId, setAssociateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const node = nodes.find(n => n.nodeId === nodeId);
  const executors = availableEmployeeExecutors(node);
  const grant = executorGrant(node, executor);
  const grantNotice = l(grant === 'revoked' ? 'capabilityRevokedConfirm' : 'grantOnSaveConfirm').replace('{capability}', executorDisplay(executor));
  const valid = !!name.trim() && !!roleDescription.trim() && !!nodeId && !!executor && !!workdirBindingId;
  function reset() {setName(''); setRoleDescription(''); setTitle(''); setModel(''); setNodeId(''); setExecutor(''); setWorkdirBindingId(''); setAssociateId(''); setError(false);}
  function close() {if (busy) return; reset(); onClose();}
  async function submit() {
    if (busy || !valid) return;
    // Choosing an executor grants its capability on the device; a revoked one only returns after the owner confirms.
    if (grant !== 'granted' && !window.confirm(grantNotice)) return;
    setBusy(true); setError(false); onLockChange(true);
    try {
      const created = await api.createEmployee({requestId: crypto.randomUUID(), name: name.trim(), nodeId, executor, workdirBindingId,
        title: title.trim(), roleDescription: roleDescription.trim(), model: model.trim(), ...(grant === 'revoked' ? {authorizeCapability: true} : {})});
      const binding = workspaceBindingGrant(nodeId, `agent.${executor}`, bindings, nodes);
      if (binding) await api.createBinding(workspaceId, binding.nodeId, binding.capability);
      await api.associateEmployee(workspaceId, created.agentId);
      reset(); onCreated();
    } catch {setError(true);}
    finally {setBusy(false); onLockChange(false);}
  }
  async function associate() {
    if (busy || readOnly || !associateId) return;
    setBusy(true); setError(false); onLockChange(true);
    try {
      const candidate = candidates.find(c => c.agentId === associateId);
      const binding = candidate ? workspaceBindingGrant(candidate.nodeId, `agent.${candidate.executor}`, bindings, nodes) : null;
      if (binding) await api.createBinding(workspaceId, binding.nodeId, binding.capability);
      await api.associateEmployee(workspaceId, associateId); setAssociateId(''); onAssociated();
    } catch {setError(true);}
    finally {setBusy(false); onLockChange(false);}
  }
  return <Dialog open={open} onOpenChange={o => {if (!o) close();}}>
    <DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{l('addEmployee')}</DialogTitle>
        <DialogDescription>{l('addEmployeeHint')}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={e => {e.preventDefault(); void submit();}}>
        <label className="grid gap-1.5 text-sm font-medium">{l('employeeNameLabel')}
          <input className={wsField} value={name} maxLength={80} disabled={busy} onChange={e => setName(e.target.value)}/>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">{l('roleDescription')}
          <textarea className={wsField} value={roleDescription} maxLength={2000} disabled={busy} onChange={e => setRoleDescription(e.target.value)}/>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">{l('employeeTitle')}
          <input className={wsField} value={title} maxLength={80} disabled={busy} onChange={e => setTitle(e.target.value)}/>
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
            {executors.map(e => {const state = executorGrant(node, e); return <option key={e} value={e}>{executorDisplay(e)}{state === 'granted' ? '' : ` · ${l(state === 'revoked' ? 'executorRevoked' : 'executorGrantOnSave')}`}</option>;})}
          </select>
        </label>
        {!!executor && grant !== 'granted' && <p className="text-sm text-muted-foreground" data-testid="employee-grant-notice">{grantNotice}</p>}
        <label className="grid gap-1.5 text-sm font-medium">{l('workdirLabel')}
          <select className={wsField} value={workdirBindingId} disabled={busy || !nodeId} onChange={e => setWorkdirBindingId(e.target.value)}>
            <option value="">{l('workdirLabel')}</option>
            {node?.workdirs?.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">{l('modelLabel')}
          <input className={wsField} value={model} maxLength={120} placeholder={l('modelDefault')} disabled={busy} onChange={e => setModel(e.target.value)}/>
        </label>
        <p className="text-sm text-muted-foreground">{l('privateNotImported')}</p>
        <div className="space-y-2 border-t pt-4">
          <label className="grid gap-1.5 text-sm font-medium">{l('link')}
            <select className={wsField} value={associateId} disabled={busy || readOnly} onChange={e => setAssociateId(e.target.value)}><option value="">{l('none')}</option>{candidates.map(e => <option key={e.agentId} value={e.agentId}>{e.name}</option>)}</select>
          </label>
          <Button type="button" variant="outline" disabled={busy || readOnly || !associateId} onClick={() => void associate()}>{l('link')}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{l('error')}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={close}>{l('cancel')}</Button>
          <Button type="submit" disabled={busy || !valid}>{l('createEmployeeBtn')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
