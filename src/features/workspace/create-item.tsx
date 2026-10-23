import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Binding, Project, WorkspaceApi } from './api';
import { workspaceItemIntent } from './create-item-storage';
import { usePageLabels } from './page-labels';
import { workspaceField } from './project-management';
import { spaceSession } from './space-session';
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
  const [targetId, setTargetId] = useState('');
  const [bindingId, setBindingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const ready = employeePages.ready && !employeePages.error;
  const [assignMode, setAssignMode] = useState<boolean>();
  const running = useRef(false);
  const live = useRef(true);
  const employee = employees.find(e => e.employeeId === employeeId && e.available);
  const session = employee && spaceSession(employee);
  const targets = projects.find(p => p.id === projectId)?.targets.filter(t => employee?.projectTargetIds.includes(t.id ?? '')) ?? [];
  const matching = bindings.filter(b => b.revoked === 0 && b.nodeId === employee?.nodeId && b.capability === employee?.capability);
  const selectedBinding = matching.length === 1 ? matching[0]?.id : bindingId;
  const selectedTarget = targets.length === 1 ? targets[0]?.id : targetId;
  const locked = busy || intent.locked;
  useEffect(() => {onLockChange(intent.locked);}, [intent]);
  useEffect(() => {live.current = true; void Promise.all([api.projects(workspaceId), api.bindings(workspaceId)]).then(([p,b]) => {if (live.current) {setProjects(p); setBindings(b);}}).catch(() => {if (live.current) setError(true);}); return () => {live.current = false;};}, [api, workspaceId]);
  useEffect(() => {setEmployeeId(''); setTargetId(''); setBindingId('');}, [api, workspaceId, projectId]);
  async function submit(assign: boolean) {
    if (running.current) return;
    running.current = true; setAssignMode(assign); setBusy(true); setError(false); onLockChange(true);
    let completed = false;
    try {
      if (intent.locked) await intent.retry(api);
      else await intent.run(api, {workspaceId, title, description, acceptance, projectId: projectId || null}, assign ? {employeeId, bindingId: selectedBinding!, text: [description || title, acceptance].filter(Boolean).join('\n\n'), ...(selectedTarget ? {projectTargetId: selectedTarget} : {})} : undefined);
      if (intent.assignmentReceipt?.deliveryBlockedReason) return;
      completed = true;
      if (live.current) {onLockChange(false); onCreated();}
    } catch {if (live.current) setError(true);}
    finally {running.current = false; if (live.current) {setBusy(false); onLockChange(!completed && intent.locked);}}
  }
  return <section className="space-y-3" data-testid="create-work-item">
    <header className="flex justify-between"><Button variant="ghost" disabled={locked} onClick={onBack}>{l('back')}</Button><h2>{l('createItem')}</h2></header>
    {error && <p role="alert">{l(intent.item ? 'savedNotAssigned' : 'error')}</p>}
    {intent.assignmentReceipt?.deliveryBlockedReason && <div role="alert" data-testid="delivery-blocked" className="space-y-1"><p>{l('deliveryBlocked')}</p><p>{l('deliveryBlockedHint')}</p><p>{l('requestIdentity')}: {String(intent.assign.pendingRequest?.body.requestId ?? '')}</p>{intent.assignmentReceipt.executionId && <p>{l('acceptedExecution')}: {intent.assignmentReceipt.executionId}</p>}</div>}
    {employeePages.error && <p role="alert">{l(employeePages.errorCode ?? 'error')}</p>}
    <fieldset disabled={locked} className="space-y-3">
      <label>{l('title')}<input className={workspaceField} maxLength={200} value={title} onChange={e => setTitle(e.target.value)}/></label>
      <label>{l('description')}<textarea className={workspaceField} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)}/></label>
      <label>{l('acceptance')}<textarea className={workspaceField} maxLength={10000} value={acceptance} onChange={e => setAcceptance(e.target.value)}/></label>
      <label>{l('project')}<select className={workspaceField} value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">{l('none')}</option>{projects.filter(p => p.archived === 0).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>{l('employee')}<select className={workspaceField} disabled={!ready} value={employeeId} onChange={e => {setEmployeeId(e.target.value); setTargetId(''); setBindingId('');}}><option value="">{l('none')}</option>{employees.map(e => <option key={e.employeeId} value={e.employeeId} disabled={!e.available}>{e.name ?? e.employeeId}{!e.available && ` · ${e.unavailableReason ?? l('busy')}`}</option>)}</select></label>
      {employeePages.hasMore && <Button type="button" variant="outline" disabled={employeePages.busy} onClick={() => void employeePages.more()}>{l('more')}</Button>}
      {employeePages.error && <Button type="button" variant="outline" disabled={employeePages.busy} onClick={() => void (employeePages.ready ? employeePages.more() : employeePages.refresh())}>{l('retry')}</Button>}
      {employee && <><p>{l('sessionHint')}</p><p>{l('privateNotImported')}</p><p>{session?.nativeSessionId ?? l(session?.kind === 'firstSend' ? 'firstSend' : 'sessionUnknown')}</p></>}
      {matching.length > 1 && <label>{l('node')}<select className={workspaceField} value={bindingId} onChange={e => setBindingId(e.target.value)}><option value="">{l('none')}</option>{matching.map(b => <option key={b.id} value={b.id}>{b.nodeId} · {b.capability}</option>)}</select></label>}
      {targets.length > 1 && <label>{l('targets')}<select className={workspaceField} value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">{l('none')}</option>{targets.map(t => <option key={t.id} value={t.id}>{t.nodeId} · {t.workdirBindingId}</option>)}</select></label>}
      {projectId && employeeId && !targets.length && <p>{l('noTargets')}</p>}
    </fieldset>
    {intent.locked ? <Button disabled={busy} onClick={() => void submit(assignMode === true)}>{l('retry')}</Button> : <div className="flex gap-2"><Button disabled={busy || !title.trim()} onClick={() => void submit(false)}>{l('onlyCreate')}</Button><Button disabled={busy || !ready || !title.trim() || !employee || !selectedBinding || (!!projectId && !selectedTarget)} onClick={() => {if (window.confirm(`${l('sessionHint')}\n${l('privateNotImported')}`)) void submit(true);}}>{l('assign')}</Button></div>}
  </section>;
}
