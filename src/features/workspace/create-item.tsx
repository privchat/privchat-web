import { isBlocked } from './delivery-receipt';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Binding, Project, WorkspaceApi } from './api';
import { workspaceItemIntent } from './create-item-storage';
import { usePageLabels } from './page-labels';
import { wsField } from './shell';
import { useEmployeePages } from './use-employee-pages';

export function CreateItem({api, workspaceId, onBack, onCreated, onLockChange}: {api: WorkspaceApi; workspaceId: string; onBack: () => void; onCreated: () => void; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [intent] = useState(() => workspaceItemIntent(api, workspaceId));
  const [title, setTitle] = useState(intent.input?.title ?? '');
  const [description, setDescription] = useState(intent.input?.description ?? '');
  const [acceptance, setAcceptance] = useState(intent.input?.acceptance ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(intent.input?.projectId ?? '');
  const employeePages = useEmployeePages(api, workspaceId, projectId || undefined);
  const employees = employeePages.rows;
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [bindingId, setBindingId] = useState('');
  const [acknowledge, setAcknowledge] = useState<'' | 'inspect' | 'rerun'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const ready = employeePages.ready && !employeePages.error;
  const [assignMode, setAssignMode] = useState<boolean>();
  const running = useRef(false);
  const live = useRef(true);
  const employee = employees.find(e => e.employeeId === employeeId && e.available);
  const matching = bindings.filter(b => b.revoked === 0 && b.nodeId === employee?.nodeId && b.capability === employee?.capability);
  const selectedBinding = matching.length === 1 ? matching[0]?.id : bindingId;
  const locked = busy || intent.locked;
  useEffect(() => {onLockChange(intent.locked); return () => onLockChange(false);}, [intent]);
  useEffect(() => {live.current = true; void Promise.all([api.projects(workspaceId), api.bindings(workspaceId)]).then(([p,b]) => {if (live.current) {setProjects(p); setBindings(b);}}).catch(() => {if (live.current) setError(true);}); return () => {live.current = false;};}, [api, workspaceId]);
  useEffect(() => {setEmployeeId(''); setBindingId(''); setAcknowledge('');}, [api, workspaceId, projectId]);
  async function submit(assign: boolean) {
    if (running.current) return;
    running.current = true; setAssignMode(assign); setBusy(true); setError(false); onLockChange(true);
    let completed = false;
    try {
      if (intent.locked) await intent.retry(api);
      else await intent.run(api, {workspaceId, title, description, acceptance, projectId: projectId || null}, assign ? {employeeId, bindingId: selectedBinding!, text: [description || title, acceptance].filter(Boolean).join('\n\n'), ...(employee?.previousResultUnknown && acknowledge ? {acknowledgeUnknown: acknowledge} : {})} : undefined);
      if (isBlocked(intent.assignmentReceipt)) return;
      completed = true;
      if (live.current) {onLockChange(false); onCreated();}
    } catch {if (live.current) setError(true);}
    finally {running.current = false; if (live.current) {setBusy(false); onLockChange(!completed && intent.locked);}}
  }
  return <section className="mx-auto w-full max-w-[460px] rounded-xl border bg-card p-[22px]" data-testid="create-work-item">
    <header className="flex items-start justify-between gap-2">
      <div><h2 className="text-[17px] font-semibold">{l('createItem')}</h2><p className="mt-1 text-sm text-muted-foreground">{l('newTaskHint')}</p></div>
      <Button variant="ghost" size="sm" disabled={locked} onClick={onBack}>{l('back')}</Button>
    </header>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{l(intent.item ? 'savedNotAssigned' : 'error')}</p>}
    {isBlocked(intent.assignmentReceipt) && intent.assignmentReceipt && <div role="alert" data-testid="delivery-blocked" className="mt-3 space-y-1 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm"><p>{l('deliveryBlocked')}</p><p>{l('deliveryBlockedHint')}</p><p>{l('requestIdentity')}: {String(intent.assign.pendingRequest?.body.requestId ?? '')}</p>{intent.assignmentReceipt.executionId && <p>{l('acceptedExecution')}: {intent.assignmentReceipt.executionId}</p>}</div>}
    {employeePages.error && <p role="alert" className="mt-3 text-sm text-destructive">{l(employeePages.errorCode ?? 'error')}</p>}
    <fieldset disabled={locked} className="mt-1 space-y-0">
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('title')}<input className={wsField} maxLength={200} value={title} onChange={e => setTitle(e.target.value)}/></label>
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('description')}<textarea className={wsField} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)}/></label>
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('acceptance')}<textarea className={wsField} maxLength={10000} value={acceptance} onChange={e => setAcceptance(e.target.value)}/></label>
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('project')}<select className={wsField} value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">{l('none')}</option>{projects.filter(p => p.archived === 0).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('employee')}<select className={wsField} disabled={!ready} value={employeeId} onChange={e => {setEmployeeId(e.target.value); setBindingId(''); setAcknowledge('');}}><option value="">{l('none')}</option>{employees.map(e => <option key={e.employeeId} value={e.employeeId} disabled={!e.available}>{e.name ?? e.employeeId}{!e.available && ` · ${e.unavailableReason ?? l('busy')}`}</option>)}</select></label>
      {employeePages.hasMore && <Button type="button" variant="outline" size="sm" disabled={employeePages.busy} onClick={() => void employeePages.more()}>{l('more')}</Button>}
      {employeePages.error && <Button type="button" variant="outline" size="sm" disabled={employeePages.busy} onClick={() => void (employeePages.ready ? employeePages.more() : employeePages.refresh())}>{l('retry')}</Button>}
      {employee && <div className="my-2 space-y-1 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm text-muted-foreground"><p>{l('sessionHint')}</p><p>{l('privateNotImported')}</p><p>{l('sessionUnknown')}</p></div>}
      {employee?.previousResultUnknown && <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('acknowledgeUnknown')}<select className={wsField} value={acknowledge} onChange={e => setAcknowledge(e.target.value as '' | 'inspect' | 'rerun')}><option value="">{l('none')}</option><option value="inspect">{l('acknowledgeInspect')}</option><option value="rerun">{l('acknowledgeRerun')}</option></select></label>}
      {matching.length > 1 && <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('node')}<select className={wsField} value={bindingId} onChange={e => setBindingId(e.target.value)}><option value="">{l('none')}</option>{matching.map(b => <option key={b.id} value={b.id}>{b.nodeId} · {b.capability}</option>)}</select></label>}
    </fieldset>
    <div className="mt-[19px] flex justify-end gap-2">
      {intent.locked ? <Button disabled={busy} onClick={() => void submit(assignMode === true)}>{l('retry')}</Button> : <><Button variant="outline" disabled={busy || !title.trim()} onClick={() => void submit(false)}>{l('onlyCreate')}</Button><Button disabled={busy || !ready || !title.trim() || !employee || !selectedBinding || (!!employee?.previousResultUnknown && !acknowledge)} onClick={() => {if (window.confirm(`${l('sessionHint')}\n${l('privateNotImported')}`)) void submit(true);}}>{l('assign')}</Button></>}
    </div>
  </section>;
}
