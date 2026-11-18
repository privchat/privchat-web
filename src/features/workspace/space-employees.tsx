import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PlatformApiError } from '@/lib/platform-errors';
import { employeeCreationIntent } from './console-intent-storage';
import { Bot, Circle, LoaderCircle, Plus } from 'lucide-react';
import {TaskHistory} from './task-history';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Binding, Employee, Node, Workspace, WorkspaceApi, WorkspaceEmployee } from './api';
import { availableEmployeeExecutors, employeeExecutor, executorDefaultModel, executorDisplay, executorModels, ModelField } from './employees';
import { employeeCause, executorGrant, grantableWorkspaceBinding, workspaceBindingGrant } from './employee-access';
import { employeeReasonLabel, usePageLabels, type WorkspaceLabelKey } from './page-labels';
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
  const [creation] = useState(() => employeeCreationIntent(api, workspaceId));
  const [adding, setAdding] = useState(creation.hasPending);
  const [associating, setAssociating] = useState(false);
  const [associateId, setAssociateId] = useState('');
  const [manageId, setManageId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const readOnly = !space || space.archived !== 0 || !['owner', 'admin', 'member'].includes(space.myRole);
  const unlinked = owned.filter(e => !rows.some(r => r.employeeId === e.agentId));
  const managed = rows.find(r => r.id === manageId);
  const managedCause = managed ? employeeCause(managed, bindings, nodes) : undefined;
  const managedGrant = managed ? grantableWorkspaceBinding(managed, bindings, nodes) : null;
  const managedOwn = !!managed && owned.some(e => e.agentId === managed.employeeId);
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
    <WsPageHeader title={l('employeesTitle')} subtitle={l('employeesSub')} actions={<>
      {!!unlinked.length && !readOnly && employeePages.ready && !employeePages.hasMore &&
        <Button variant="outline" disabled={busy || creation.hasPending} onClick={() => setAssociating(true)}>{l('link')}</Button>}
      <Button disabled={readOnly || busy} onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{l('addEmployee')}</Button>
    </>} />
    <Dialog open={associating} onOpenChange={open => {if (!busy) {setAssociating(open); if (!open) setAssociateId('');}}}>
      <DialogContent>
        <DialogHeader><DialogTitle>{l('link')}</DialogTitle></DialogHeader>
        <label className="grid gap-1.5 text-sm font-medium">{l('link')}
          <select className={wsField} value={associateId} disabled={busy || readOnly} onChange={e => setAssociateId(e.target.value)}>
            <option value="">{l('none')}</option>
            {unlinked.map(e => <option key={e.agentId} value={e.agentId}>{e.name}</option>)}
          </select>
        </label>
        {error && <p role="alert">{l('error')}</p>}
        <DialogFooter><Button disabled={busy || readOnly || !associateId} onClick={() => void act(async () => {
          const employee = unlinked.find(e => e.agentId === associateId);
          if (!employee) return;
          const binding = workspaceBindingGrant(employee.nodeId, `agent.${employee.executor}`, bindings, nodes);
          if (binding) await api.createBinding(workspaceId, binding.nodeId, binding.capability);
          await api.associateEmployee(workspaceId, employee.agentId);
          setAssociateId(''); setAssociating(false);
        })}>{l('link')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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
    {rows.length > 0 && <WsTable head={<><WsTh>{l('colEmployee')}</WsTh><WsTh>{l('colExecutor')}</WsTh><WsTh>{l('colDevice')}</WsTh><WsTh>{l('colStatus')}</WsTh></>}>
      {rows.map(row => {const s = status(row); return <tr key={row.id} className="hover:bg-accent/40">
        <WsTd><button type="button" className="font-semibold hover:underline focus-visible:underline" onClick={() => setManageId(row.id)}>{row.name || l('unnamedEmployee')}</button></WsTd>
        <WsTd>{executorDisplay(employeeExecutor(row.capability ?? '') ?? row.capability ?? '')}</WsTd>
        <WsTd>{nodes.find(n => n.nodeId === row.nodeId)?.name ?? row.nodeId ?? '—'}</WsTd>
        <WsTd>{s.pill ? <StatusPill icon={s.icon}>{s.text}</StatusPill> : <span className="block max-w-[300px] text-xs text-muted-foreground">{s.text}</span>}</WsTd>
      </tr>;})}
    </WsTable>}
    {!rows.length && <div className="rounded-[9px] border py-[58px] text-center text-muted-foreground">
      <Bot className="mx-auto h-6 w-6" aria-hidden="true" />
      <p className="mt-2 text-sm">{l('noLinkedEmployees')}</p>
    </div>}
    {employeePages.hasMore && <div className="mt-3"><Button variant="outline" disabled={busy || employeePages.busy} onClick={() => void employeePages.more()}>{l('more')}</Button></div>}
    <AddEmployeeDialog api={api} creation={creation} names={[...owned.map(e => e.name), ...rows.map(r => r.name ?? '')]} nodes={nodes} bindings={bindings} workspaceId={workspaceId} readOnly={readOnly} open={adding} onClose={() => setAdding(false)} onCreated={employee => {setOwned(current => [...current, employee]); setAdding(false); void reload().catch(() => setError(true));}} onLockChange={onLockChange}/>
  </section>;
}

function AddEmployeeDialog({api, creation, names, nodes, bindings, workspaceId, readOnly, open, onClose, onCreated, onLockChange}: {api: WorkspaceApi; creation: ReturnType<typeof employeeCreationIntent>; names: string[]; nodes: Node[]; bindings: Binding[]; workspaceId: string; readOnly: boolean; open: boolean; onClose: () => void; onCreated: (employee: Employee) => void; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [model, setModel] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [executor, setExecutor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<WorkspaceLabelKey>();
  const running = useRef(false);
  const pending = creation.hasPending;
  const workstations = nodes.filter(n => n.state === 'active' && n.revokedAt == null);
  const node = workstations.find(n => n.nodeId === nodeId);
  const executors = availableEmployeeExecutors(node);
  const models = executorModels(node, executor);
  const modelName = models.find(m => m.id === model)?.name || model || executorDefaultModel(node, executor);
  const used = new Set(names.map(n => n.trim().toLowerCase()));
  const base = executor ? [executorDisplay(executor), modelName].filter(Boolean).join(' · ') : '';
  let suggested = base.slice(0, 64);
  for (let i = 2; suggested && used.has(suggested.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    suggested = base.slice(0, 64 - suffix.length) + suffix;
  }
  const name = suggested;
  const grant = executorGrant(node, executor);
  const grantNotice = l(grant === 'revoked' ? 'capabilityRevokedConfirm' : 'grantOnSaveConfirm').replace('{capability}', executorDisplay(executor));
  const valid = !!name.trim() && !used.has(name.trim().toLowerCase()) && !!node && executors.includes(executor) &&
    (!model || models.some(m => m.id === model));
  function reset() {setModel(''); setNodeId(''); setExecutor(''); setError(undefined);}
  function close() {if (running.current || pending) return; reset(); onClose();}
  async function submit() {
    if (running.current || readOnly || (!pending && !valid)) return;
    if (!pending && grant !== 'granted' && !window.confirm(grantNotice)) return;
    running.current = true; setBusy(true); setError(undefined); onLockChange(true);
    try {
      // Retain the creation receipt's request identity until the employee is associated.
      const retain = (created: Employee) => {
        if (!created?.agentId) throw new Error('Invalid employee creation receipt');
        return true;
      };
      const created = pending ? await creation.retry(api, retain) : await creation.run(api, '/agent/agents', {
        name: name.trim(), nodeId, executor, workdirBindingId: '', title: '', roleDescription: '', model,
        ...(grant === 'revoked' ? {authorizeCapability: true} : {}),
      }, 'requestId', retain);
      if (created.workdirBindingId || created.executionId) {
        creation.complete(); setError('employeeCreateUnsupported'); return;
      }
      const binding = workspaceBindingGrant(created.nodeId, `agent.${created.executor}`, bindings, nodes);
      if (binding) await api.createBinding(workspaceId, binding.nodeId, binding.capability);
      await api.associateEmployee(workspaceId, created.agentId);
      creation.complete();
      reset(); onCreated(created);
    } catch (e) {
      setError(e instanceof PlatformApiError && ['AGENT_DEFINITION_INVALID', 'AGENT_WORKDIR_NOT_ALLOWED'].includes(e.machineCode ?? '') ? 'employeeCreateUnsupported' : 'error');
    } finally {running.current = false; setBusy(false); onLockChange(creation.hasPending);}
  }
  return <Dialog open={open} onOpenChange={o => {if (!o) close();}}>
    <DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{l('addEmployee')}</DialogTitle>
        <DialogDescription>{l('addEmployeeHint')}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={e => {e.preventDefault(); void submit();}}>
        {pending ? <p role="status">{l('pendingRetry')} {String(creation.pendingRequest?.body.name ?? '')}</p> : !workstations.length && !readOnly ?
          <Button type="button" onClick={() => navigateWorkspace({view: 'devices'})}>{l('taskConnectDevice')}</Button> : <>
        <label className="grid gap-1.5 text-sm font-medium">{l('deviceNodeLabel')}
          <select className={wsField} value={nodeId} disabled={busy} onChange={e => {setNodeId(e.target.value); setExecutor(''); setModel('');}}>
            <option value="">{l('deviceNodeLabel')}</option>
            {workstations.map(n => <option key={n.nodeId} value={n.nodeId}>{n.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">{l('executorLabel')}
          <select className={wsField} value={executor} disabled={busy || !nodeId} onChange={e => {setExecutor(e.target.value); setModel('');}}>
            <option value="">{l('executorLabel')}</option>
            {executors.map(e => {const state = executorGrant(node, e); return <option key={e} value={e}>{executorDisplay(e)}{state === 'granted' ? '' : ` · ${l(state === 'revoked' ? 'executorRevoked' : 'executorGrantOnSave')}`}</option>;})}
          </select>
        </label>
        {!!executor && grant !== 'granted' && <p className="text-sm text-muted-foreground" data-testid="employee-grant-notice">{grantNotice}</p>}
        <ModelField reportedOnly node={node} executor={executor} value={model} disabled={busy || !executor} onChange={setModel}/>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{l(error)}</p>}
        {(pending || workstations.length > 0) && <DialogFooter>
          <Button type="button" variant="outline" disabled={busy || pending} onClick={close}>{l('cancel')}</Button>
          <Button type="submit" disabled={busy || readOnly || (!pending && !valid)}>{l(pending ? 'retry' : 'createEmployeeBtn')}</Button>
        </DialogFooter>}
      </form>
    </DialogContent>
  </Dialog>;
}
