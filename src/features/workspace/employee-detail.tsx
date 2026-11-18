import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PlatformApiError } from '@/lib/platform-errors';
import type { Binding, Employee, Node, Workspace, WorkspaceApi } from './api';
import { ConsoleIntent } from './console-intent';
import { employeeCause, executorGrant, grantableWorkspaceBinding } from './employee-access';
import { availableEmployeeExecutors, executorDisplay, ModelField } from './employees';
import { employeeReasonLabel, usePageLabels, type WorkspaceLabelKey } from './page-labels';
import { navigateWorkspace } from './routes';
import { WsPageHeader, wsField } from './shell';
import { TaskHistory } from './task-history';
import { useEmployeePages } from './use-employee-pages';

/** Rejections the owner can act on keep their own words; everything else stays the generic retry message. */
function failureKey(e: unknown): WorkspaceLabelKey {
  const code = e instanceof PlatformApiError ? e.machineCode : undefined;
  if (code === 'AGENT_CAPABILITY_REVOKED') return 'reasonCapabilityRevoked';
  if (code === 'AGENT_MODEL_UNSUPPORTED') return 'reasonModelUnsupported';
  if (code === 'AGENT_SESSION_BUSY') return 'reasonBusy';
  if (code === 'AGENT_EXECUTION_CONFLICT') return 'conflict';
  return 'error';
}

/** Employee detail, profile edit and the explicit rebind (§18.14). The identity and its task history never change here. */
export function EmployeeDetail({api, workspaceId, employeeId, panel, onLockChange}: {api: WorkspaceApi; workspaceId: string; employeeId: string; panel?: 'profile' | 'rebind'; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const employeePages = useEmployeePages(api, workspaceId);
  const [space, setSpace] = useState<Workspace>();
  const [owned, setOwned] = useState<Employee[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [mode, setMode] = useState<'view' | 'profile' | 'rebind'>(panel ?? 'view');
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<WorkspaceLabelKey | ''>('');
  const [saved, setSaved] = useState<WorkspaceLabelKey | ''>('');
  const [profile, setProfile] = useState({name: ''});
  const [draft, setDraft] = useState({nodeId: '', executor: '', model: ''});
  const [baseVersion, setBaseVersion] = useState<number>();
  const profileIntent = useRef(new ConsoleIntent());
  const rebindIntent = useRef(new ConsoleIntent());
  const live = useRef(true);
  const own = owned.find(e => e.agentId === employeeId);
  const linked = employeePages.rows.find(r => r.employeeId === employeeId);
  const readOnly = !space || space.archived !== 0 || !['owner', 'admin', 'member'].includes(space.myRole);
  const cause = linked ? employeeCause(linked, bindings, nodes) : undefined;
  const grantable = linked && !readOnly ? grantableWorkspaceBinding(linked, bindings, nodes) : null;
  const reauthorizable = !!own?.nodeId && (cause === 'capabilityRevoked' || cause === 'capabilityNotGranted');
  const node = nodes.find(n => n.nodeId === draft.nodeId);
  const executors = availableEmployeeExecutors(node);
  const grant = executorGrant(node, draft.executor);
  const version = own?.bindingVersion ?? 0;
  const conflict = !!own && baseVersion !== undefined && baseVersion !== version;
  const pending = profileIntent.current.hasPending || rebindIntent.current.hasPending;
  const locked = busy || pending;
  const canEditProfile = !!own?.nodeId && !!own.executor;
  const profileValid = !!profile.name.trim();
  const rebindValid = !!own && !readOnly && !conflict && node?.state === 'active' && executors.includes(draft.executor);
  const deviceName = (id?: string | null) => nodes.find(n => n.nodeId === id)?.name ?? l('unavailable');
  const summary = (nodeId?: string | null, executor?: string, model?: string) =>
    `${deviceName(nodeId)} · ${executorDisplay(executor ?? '')} · ${model?.trim() || l('modelDefault')}`;
  const oldSummary = summary(own?.nodeId, own?.executor, own?.model);
  const newSummary = summary(draft.nodeId, draft.executor, draft.model);

  async function load() {
    setBusy(true); setError('');
    try {
      const [current, profiles, devices, grants] = await Promise.all([api.space(workspaceId), api.employees(), api.nodes(), api.bindings(workspaceId), employeePages.refresh()]);
      if (!live.current) return;
      setSpace(current); setOwned(profiles); setNodes(devices); setBindings(grants);
    } catch (e) {if (live.current) setError(failureKey(e));}
    finally {if (live.current) setBusy(false);}
  }
  useEffect(() => {live.current = true; void load(); return () => {live.current = false; onLockChange(false);};}, [api, workspaceId, employeeId]);
  useEffect(() => {onLockChange(locked);}, [locked]);
  // A new binding version means the draft was read against an older one: start over instead of retargeting silently.
  useEffect(() => {
    if (!own) return;
    setProfile({name: own.name});
    setDraft({nodeId: own.nodeId ?? '', executor: own.executor, model: own.model});
    setBaseVersion(own.bindingVersion ?? 0);
  }, [own?.agentId, own?.bindingVersion]);

  async function act(run: () => Promise<void>) {
    if (locked && !pending) return;
    setBusy(true); setError(''); setSaved('');
    try {await run();} catch (e) {if (live.current) setError(failureKey(e));}
    finally {if (live.current) setBusy(false);}
  }
  /** The response must be a newer binding of the same employee on the confirmed target; a malformed success keeps the request key. */
  function rebound(body: Record<string, unknown>) {
    return (result: Employee) => {
      if (result.agentId !== body.agentId || (result.bindingVersion ?? 0) <= Number(body.expectedBindingVersion)
        || result.nodeId !== body.nodeId || result.executor !== body.executor || result.model !== body.model
        || (result.workdirBindingId ?? '') !== body.workdirBindingId || (result.executionId ?? null) !== body.bindExecutionId) {
        throw new Error('Invalid rebind receipt');
      }
      return false;
    };
  }
  async function saveProfile() {
    if (!own || readOnly || !canEditProfile || !profileValid) return;
    // An ordinary profile change carries the existing routing and never a session (§18.14).
    const body = {agentId: own.agentId, name: profile.name.trim(), roleDescription: own.roleDescription, title: own.title,
      model: own.model, nodeId: own.nodeId!, executor: own.executor, workdirBindingId: own.workdirBindingId ?? ''};
    await act(async () => {
      await profileIntent.current.run<Employee>(api, '/agent/agents/update', body, 'requestId');
      if (!live.current) return;
      setMode('view'); setSaved('profileSaved'); await load();
    });
  }
  async function reauthorize() {
    if (!own?.nodeId || !window.confirm(l('reauthorizeHint').replace('{name}', own.name))) return;
    const body = {agentId: own.agentId, name: own.name, roleDescription: own.roleDescription, title: own.title, model: own.model,
      nodeId: own.nodeId, executor: own.executor, workdirBindingId: own.workdirBindingId ?? '', authorizeCapability: true};
    await act(async () => {await profileIntent.current.run<Employee>(api, '/agent/agents/update', body, 'requestId'); if (live.current) await load();});
  }
  async function saveRebind() {
    if (!own || !rebindValid) return;
    const notice = grant === 'granted' ? '' : `\n${l(grant === 'revoked' ? 'capabilityRevokedConfirm' : 'grantOnSaveConfirm').replace('{capability}', executorDisplay(draft.executor))}`;
    if (!window.confirm(`${l('rebindConfirm')}\n${oldSummary} → ${newSummary}${notice}`)) return;
    const body = {agentId: own.agentId, expectedBindingVersion: baseVersion ?? version, nodeId: draft.nodeId, executor: draft.executor,
      model: draft.model.trim(), workdirBindingId: '', bindExecutionId: null,
      ...(grant === 'revoked' ? {authorizeCapability: true} : {})};
    await act(async () => {
      await rebindIntent.current.run<Employee>(api, '/agent/employees/rebind', body, 'requestId', rebound(body));
      if (!live.current) return;
      setMode('view'); setSaved('rebindSaved'); await load();
    });
  }
  async function retryPending() {
    await act(async () => {
      if (rebindIntent.current.hasPending) {
        const request = rebindIntent.current.pendingRequest;
        await rebindIntent.current.retry<Employee>(api, request ? rebound(request.body) : undefined);
      } else await profileIntent.current.retry<Employee>(api);
      if (!live.current) return;
      setMode('view'); setSaved('rebindSaved'); await load();
    });
  }
  async function grantWorkspace() {
    if (!grantable) return;
    const device = deviceName(grantable.nodeId), capability = executorDisplay(grantable.capability.replace(/^agent\./, ''));
    if (!window.confirm(`${l('grantNotice').replace('{device}', device).replace('{capability}', capability)}\n${l('grantConfirm').replace('{device}', device).replace('{capability}', capability)}`)) return;
    await act(async () => {await api.createBinding(workspaceId, grantable.nodeId, grantable.capability); if (live.current) await load();});
  }
  async function unlink() {
    if (!linked || !window.confirm(`${linked.name || l('unnamedEmployee')}\n${l('deleteBindingConfirm')}`)) return;
    await act(async () => {await api.removeEmployeeAssociation(linked.id); if (live.current) navigateWorkspace({view: 'employees', spaceId: workspaceId});});
  }
  const back = () => navigateWorkspace({view: 'employees', spaceId: workspaceId});
  if (history) return <TaskHistory api={api} scope={{employeeId}} onBack={() => setHistory(false)}/>;
  return <section data-testid="employee-detail" className="w-full min-w-0 space-y-3">
    <WsPageHeader title={linked?.name || own?.name || l('unnamedEmployee')} subtitle={l('employeeDetailSub')} actions={<>
      <Button variant="ghost" size="sm" disabled={locked} onClick={back}>{l('back')}</Button>
      <Button variant="outline" size="sm" disabled={locked} onClick={() => setHistory(true)}>{l('taskRecords')}</Button>
      {!readOnly && own && <Button variant="outline" size="sm" disabled={locked || !canEditProfile} onClick={() => {setMode('profile'); setSaved('');}}>{l('editProfile')}</Button>}
      {!readOnly && own && <Button variant="outline" size="sm" disabled={locked} onClick={() => {setMode('rebind'); setSaved('');}}>{l('rebindAction')}</Button>}
      {!readOnly && linked && <Button variant="destructive" size="sm" disabled={locked} onClick={() => void unlink()}>{l('unlink')}</Button>}
    </>} />
    {error && <p role="alert" className="text-sm text-destructive">{l(error)}</p>}
    {saved && <p role="status" className="text-sm text-muted-foreground">{l(saved)}</p>}
    {employeePages.error && <p role="alert" className="text-sm text-destructive">{l(employeePages.errorCode ?? 'error')}</p>}
    {pending && <div className="space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm" data-testid="employee-pending">
      <p>{l('pendingRetry')}</p>
      <Button size="sm" disabled={busy} onClick={() => void retryPending()}>{l('retry')}</Button>
    </div>}
    {!linked && employeePages.ready && !employeePages.error && <div className="space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
      <p>{l('noLinkedEmployees')}</p>
      {employeePages.hasMore && <Button variant="outline" size="sm" disabled={busy || employeePages.busy} onClick={() => void employeePages.more()}>{l('more')}</Button>}
    </div>}
    {cause && <div className="space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm" data-testid="employee-unavailable">
      <p>{l(employeeReasonLabel[cause])}</p>
      {grantable && <Button variant="outline" size="sm" disabled={locked} onClick={() => void grantWorkspace()}>{l('grantDeviceAction')}</Button>}
      {reauthorizable && <Button variant="outline" size="sm" disabled={locked} onClick={() => void reauthorize()}>{l('reauthorizeAction')}</Button>}
    </div>}
    {linked?.previousResultUnknown && <p className="rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm text-muted-foreground">{l('previousUnknownNotice')}</p>}

    {mode === 'profile' && own && !readOnly && <div className="rounded-[9px] border bg-card p-4">
      <h2 className="text-sm font-semibold">{l('editProfile')}</h2>
      <form className="mt-3 space-y-3" onSubmit={e => {e.preventDefault(); if (!locked && profileValid) void saveProfile();}}>
        <label className="grid gap-1.5 text-sm font-medium">{l('employeeNameLabel')}<input className={wsField} maxLength={64} disabled={locked} value={profile.name} onChange={e => setProfile({...profile, name: e.target.value})}/></label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setMode('view')}>{l('cancel')}</Button>
          <Button type="submit" disabled={locked || !profileValid}>{l('save')}</Button>
        </div>
      </form>
    </div>}

    <div className="rounded-[9px] border bg-card p-4">
      <h2 className="text-sm font-semibold">{l('workBinding')}</h2>
      {mode === 'rebind' && own && !readOnly ? <form className="mt-3 space-y-3" onSubmit={e => {e.preventDefault(); if (!locked && rebindValid) void saveRebind();}}>
        <p className="text-sm text-muted-foreground">{l('rebindHint')}</p>
        {conflict && <p role="alert" className="text-sm text-destructive" data-testid="rebind-conflict">{l('conflict')}</p>}
        <label className="grid gap-1.5 text-sm font-medium">{l('deviceNodeLabel')}
          <select className={wsField} value={draft.nodeId} disabled={locked} onChange={e => {setDraft({nodeId: e.target.value, executor: '', model: ''});}}>
            <option value="">{l('deviceNodeLabel')}</option>
            {nodes.map(n => <option key={n.nodeId} value={n.nodeId} disabled={n.state !== 'active'}>{n.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">{l('executorLabel')}
          <select className={wsField} value={draft.executor} disabled={locked || !node} onChange={e => {setDraft({...draft, executor: e.target.value, model: ''});}}>
            <option value="">{l('executorLabel')}</option>
            {executors.map(x => {const state = executorGrant(node, x); return <option key={x} value={x}>{executorDisplay(x)}{state === 'granted' ? '' : ` · ${l(state === 'revoked' ? 'executorRevoked' : 'executorGrantOnSave')}`}</option>;})}
          </select>
        </label>
        {!!draft.executor && grant !== 'granted' && <p className="text-sm text-muted-foreground" data-testid="employee-grant-notice">{l(grant === 'revoked' ? 'capabilityRevokedConfirm' : 'grantOnSaveConfirm').replace('{capability}', executorDisplay(draft.executor))}</p>}
        <ModelField reportedOnly node={node} executor={draft.executor} value={draft.model} disabled={locked || !draft.executor}
          onChange={model => setDraft({...draft, model})}/>
        <dl className="grid gap-1 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm" data-testid="rebind-preview">
          <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{l('rebindCurrent')}</dt><dd className="min-w-0 break-words">{oldSummary}</dd></div>
          <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{l('rebindTarget')}</dt><dd className="min-w-0 break-words">{newSummary}</dd></div>
        </dl>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setMode('view')}>{l('cancel')}</Button>
          {conflict && <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>{l('reload')}</Button>}
          <Button type="submit" disabled={locked || !rebindValid}>{l('save')}</Button>
        </div>
      </form> : <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{l('colDevice')}</dt><dd className="min-w-0 break-words">{deviceName(own?.nodeId ?? linked?.nodeId)}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{l('colExecutor')}</dt><dd className="min-w-0 break-words">{executorDisplay(own?.executor ?? linked?.capability?.replace(/^agent\./, '') ?? '')}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{l('modelLabel')}</dt><dd className="min-w-0 break-words">{own?.model || l('modelDefault')}</dd></div>
        <p className="text-muted-foreground">{l(own ? 'privateNotImported' : 'reasonNotOwner')}</p>
      </dl>}
    </div>
  </section>;
}
