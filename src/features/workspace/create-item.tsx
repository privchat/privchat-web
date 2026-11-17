import { isBlocked } from './delivery-receipt';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Binding, Node, Project, WorkspaceApi } from './api';
import { taskSetupDraft, workspaceItemIntent } from './create-item-storage';
import { employeeReasonLabel, usePageLabels } from './page-labels';
import { wsField } from './shell';
import { useEmployeePages } from './use-employee-pages';
import { employeeExecutor, executorDisplay } from './employees';
import { CORRECTION_CHOICES, canDevelop, employeeCause, grantableWorkspaceBinding, myProjectBindings, otherMemberEmployee, projectDirectory, projectReviewer } from './employee-access';
import { workspaceHref, type WorkspaceRoute } from './routes';

export function CreateItem({api, workspaceId, initialProjectId, draftScope, onBack, onCreated, onLockChange}: {api: WorkspaceApi; workspaceId: string; initialProjectId?: string; draftScope?: string; onBack: () => void; onCreated: () => void; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [intent] = useState(() => workspaceItemIntent(api, workspaceId));
  const [storage] = useState(() => taskSetupDraft(draftScope, workspaceId));
  const [restoredDraft] = useState(() => storage.load());
  const [title, setTitle] = useState(intent.input?.title ?? restoredDraft?.title ?? '');
  const [description, setDescription] = useState(intent.input?.description ?? restoredDraft?.description ?? '');
  const [acceptance, setAcceptance] = useState(intent.input?.acceptance ?? restoredDraft?.acceptance ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(intent.input ? intent.input.projectId ?? '' : initialProjectId ?? restoredDraft?.projectId ?? '');
  const employeePages = useEmployeePages(api, workspaceId, projectId || undefined);
  const employees = employeePages.rows;
  const [bindings, setBindings] = useState<Binding[]>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [nodesKnown, setNodesKnown] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [metadataReady, setMetadataReady] = useState(false);
  const [metadataError, setMetadataError] = useState(false);
  const [employeeId, setEmployeeId] = useState(intent.assignment?.employeeId ?? '');
  const [bindingId, setBindingId] = useState('');
  const [correctionLimit, setCorrectionLimit] = useState(intent.input ? String(intent.assignment?.correctionLimit ?? '') : restoredDraft?.correctionLimit ?? '');
  const [acknowledge, setAcknowledge] = useState<'' | 'inspect' | 'rerun'>('');
  const [grantError, setGrantError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const ready = employeePages.ready && !employeePages.error;
  const [assignMode, setAssignMode] = useState<boolean>();
  const running = useRef(false);
  const live = useRef(true);
  const chosen = useRef(false);
  const restored = useRef(true);
  const selectedProject = projects.find(p => p.id === projectId);
  const candidates = employees.filter(e => !otherMemberEmployee(e) && (!projectId ||
    (e.projectIds.includes(projectId) && canDevelop(selectedProject, e.nodeId, e.workdirBindingId))));
  const row = candidates.find(e => e.employeeId === employeeId);
  const employee = row?.available ? row : undefined;
  const unbound = !!selectedProject && !myProjectBindings(selectedProject).some(b => b.directories.some(d => d.access === 'write'));
  // My binding's reviewer on the developer's device reviews the delivery by itself; never the developer (§20.3).
  const reviewerId = [projectReviewer(selectedProject, row?.nodeId)].find(id => !!id && id !== employeeId);
  const reviewerName = employees.find(e => e.employeeId === reviewerId)?.name || l('unnamedEmployee');
  const directory = projectDirectory(selectedProject, row?.nodeId, row?.workdirBindingId);
  const matching = (bindings ?? []).filter(b => b.revoked === 0 && b.nodeId === employee?.nodeId && b.capability === employee?.capability);
  const selectedBinding = matching.length === 1 ? matching[0]?.id : bindingId;
  const locked = busy || intent.locked;
  const noWorkstation = nodesKnown && !nodes.some(node => node.revokedAt == null);
  function openSetup(route: WorkspaceRoute) {
    if (!storage.save({title, description, acceptance, projectId, correctionLimit})) {setDraftError(true); return;}
    const target = workspaceHref(route);
    location.hash = target + (target.includes('?') ? '&' : '?') + new URLSearchParams({fromTask: workspaceId});
  }
  const note = (id: string) => {
    const candidate = employees.find(e => e.employeeId === id);
    if (!candidate) return undefined;
    const cause = employeeCause(candidate, bindings, nodes);
    return cause ? l(employeeReasonLabel[cause]) : candidate.previousResultUnknown ? l('previousUnknownNotice') : undefined;
  };
  useEffect(() => {onLockChange(intent.locked); return () => onLockChange(false);}, [intent]);
  async function loadMetadata() {
    setMetadataError(false);
    try {
      const [p, b] = await Promise.all([api.projects(workspaceId), api.bindings(workspaceId)]);
      if (!live.current) return;
      const open = p.filter(project => project.archived === 0);
      setProjects(open); setBindings(b); setMetadataReady(true);
      // One project: it is the one. Choose only when there are several.
      const single = open.length === 1 ? open[0] : undefined;
      if (!projectId && !intent.input && !restoredDraft && single) setProjectId(single.id);
    } catch {if (live.current) {setMetadataError(true); setError(true);}}
    // Names are display-only; a failed device lookup must not change execution authorization.
    try {const list = await api.nodes(); if (live.current) {setNodes(list); setNodesKnown(true);}} catch { /* Do not infer missing devices. */ }
  }
  useEffect(() => {live.current = true; void loadMetadata(); return () => {live.current = false;};}, [api, workspaceId]);
  useEffect(() => {
    if (restored.current) {restored.current = false; return;}
    chosen.current = false; setEmployeeId(''); setBindingId(''); setAcknowledge('');
  }, [api, workspaceId, projectId]);
  // One developer who can take it (the project's reviewers do not develop): pick it, until the owner chooses.
  useEffect(() => {
    if (chosen.current || employeeId || intent.input || !ready || employeePages.hasMore) return;
    const reviewers = new Set(myProjectBindings(selectedProject).map(b => b.reviewerEmployeeId).filter(Boolean));
    const only = candidates.filter(e => e.available && !reviewers.has(e.employeeId));
    const single = only.length === 1 ? only[0] : undefined;
    if (single) setEmployeeId(single.employeeId);
  }, [employees, employeeId, ready, selectedProject, employeePages.hasMore]);
  async function grant(nodeId: string, capability: string) {
    const device = nodes.find(n => n.nodeId === nodeId)?.name || nodeId;
    const name = executorDisplay(employeeExecutor(capability) ?? capability);
    if (!window.confirm(`${l('grantNotice').replace('{device}', device).replace('{capability}', name)}\n${l('grantConfirm').replace('{device}', device).replace('{capability}', name)}`)) return;
    setBusy(true); setGrantError(false);
    try {await api.createBinding(workspaceId, nodeId, capability); await loadMetadata(); await employeePages.refresh();}
    catch {if (live.current) setGrantError(true);}
    finally {if (live.current) setBusy(false);}
  }
  async function submit(assign: boolean) {
    if (running.current) return;
    running.current = true; setAssignMode(assign); setBusy(true); setError(false); onLockChange(true);
    let completed = false;
    try {
      if (intent.locked) await intent.retry(api);
      else await intent.run(api, {workspaceId, title, description, acceptance, projectId: projectId || null}, assign ? {
        employeeId, bindingId: selectedBinding!, text: [description || title, acceptance].filter(Boolean).join('\n\n'),
        autoReview: !!reviewerId, ...(reviewerId ? {correctionLimit: correctionLimit === '' ? null : Number(correctionLimit)} : {}),
        ...(employee?.previousResultUnknown && acknowledge ? {acknowledgeUnknown: acknowledge} : {}),
      } : undefined);
      if (isBlocked(intent.assignmentReceipt)) return;
      completed = true;
      storage.save();
      if (live.current) {onLockChange(false); onCreated();}
    } catch {if (live.current) setError(true);}
    finally {running.current = false; if (live.current) {setBusy(false); onLockChange(!completed && intent.locked);}}
  }
  return <section className="mx-auto w-full max-w-[460px] rounded-xl border bg-card p-[22px]" data-testid="create-work-item">
    <header className="flex items-start justify-between gap-2">
      <div><h2 className="text-[17px] font-semibold">{l('createItem')}</h2><p className="mt-1 text-sm text-muted-foreground">{l('newTaskHint')}</p></div>
      <Button variant="ghost" size="sm" disabled={locked} onClick={() => {storage.save(); onBack();}}>{l('back')}</Button>
    </header>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{l(intent.item ? 'savedNotAssigned' : 'error')}</p>}
    {draftError && <p role="alert" className="mt-3 text-sm text-destructive">{l('taskDraftUnavailable')}</p>}
    {isBlocked(intent.assignmentReceipt) && intent.assignmentReceipt && <div role="alert" data-testid="delivery-blocked" className="mt-3 space-y-1 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm"><p>{l('deliveryBlocked')}</p><p>{l('deliveryBlockedHint')}</p><p>{l('requestIdentity')}: {String(intent.assign.pendingRequest?.body.requestId ?? '')}</p>{intent.assignmentReceipt.executionId && <p>{l('acceptedExecution')}: {intent.assignmentReceipt.executionId}</p>}</div>}
    {employeePages.error && <p role="alert" className="mt-3 text-sm text-destructive">{l(employeePages.errorCode ?? 'error')}</p>}
    {grantError && <p role="alert" className="mt-3 text-sm text-destructive">{l('grantFailed')}</p>}
    <fieldset disabled={locked} className="mt-1 space-y-0">
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('title')}<input className={wsField} maxLength={200} value={title} onChange={e => setTitle(e.target.value)}/></label>
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('description')}<textarea className={wsField} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)}/></label>
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('acceptance')}<textarea className={wsField} maxLength={10000} value={acceptance} onChange={e => setAcceptance(e.target.value)}/></label>
      <p className="py-2 text-sm">{l('project')}: {selectedProject?.name ?? (projectId ? projectId : metadataReady ? l('none') : l('loading'))}</p>
      {noWorkstation && <div className="my-2 space-y-2 rounded-lg border bg-sidebar p-3 text-sm">
        <p>{l('taskConnectHint')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => openSetup({view: 'devices'})}>{l('taskConnectDevice')}</Button>
      </div>}
      {!noWorkstation && unbound && metadataReady && !metadataError && <div role="alert" data-testid="bind-project-first" className="my-2 space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
        <p className="font-medium">{l('bindFirst')}</p><p className="text-muted-foreground">{l('bindFirstHint')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => openSetup({view: 'project', projectId})}>{l('bindMyDirs')}</Button>
      </div>}
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('employee')}<select aria-label={l('employee')} className={wsField} disabled={!ready || candidates.length === 0} value={employeeId} onChange={e => {chosen.current = true; setEmployeeId(e.target.value); setBindingId(''); setAcknowledge('');}}><option value="">{l('none')}</option>{candidates.map(e => {
        const hint = note(e.employeeId);
        return <option key={e.employeeId} value={e.employeeId} disabled={!e.available}>{e.name || l('unnamedEmployee')}{hint && ` · ${hint}`}</option>;
      })}</select><span className="text-xs font-normal text-muted-foreground">{l('linkedEmployeeHint')}</span></label>
      {!noWorkstation && !unbound && ready && metadataReady && !metadataError && !employeePages.hasMore && candidates.length === 0 && <div className="space-y-2 pb-2 text-sm text-muted-foreground">
        <p role="status">{l('noLinkedEmployees')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => openSetup({view: 'employees', spaceId: workspaceId})}>{l('employees')}</Button>
      </div>}
      {employeePages.hasMore && <Button type="button" variant="outline" size="sm" disabled={employeePages.busy} onClick={() => void employeePages.more()}>{l('more')}</Button>}
      {employeePages.error && <Button type="button" variant="outline" size="sm" disabled={employeePages.busy} onClick={() => void (employeePages.ready ? employeePages.more() : employeePages.refresh())}>{l('retry')}</Button>}
      {metadataError && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void loadMetadata()}>{l('retry')}</Button>}
      {/* Held back only by a missing workspace binding: their device owner can grant it from here. */}
      {metadataReady && !metadataError && candidates.map(candidate => {
        const missing = grantableWorkspaceBinding(candidate, bindings, nodes);
        if (!missing) return null;
        const device = nodes.find(n => n.nodeId === missing.nodeId)?.name || missing.nodeId;
        return <div key={candidate.employeeId} role="alert" data-testid="grant-binding" className="my-2 space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
          <p className="font-medium">{candidate.name || l('unnamedEmployee')} · {l('reasonBindingMissing')}</p>
          <p className="text-muted-foreground">{l('grantNotice').replace('{device}', device).replace('{capability}', executorDisplay(employeeExecutor(missing.capability) ?? missing.capability))}</p>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void grant(missing.nodeId, missing.capability)}>{l('grantDeviceAction')}</Button>
        </div>;
      })}
      {employee && <div className="my-2 space-y-1 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm text-muted-foreground">
        <p>{l('sessionHint')}</p><p>{l('privateNotImported')}</p><p>{l('sessionUnknown')}</p>
        {directory && <p data-testid="start-directory">{l('colWorkdir')}: {directory.label} · {l(directory.access === 'write' ? 'accessWrite' : 'accessRead')}</p>}
      </div>}
      {employee?.previousResultUnknown && <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('acknowledgeUnknown')}<select className={wsField} value={acknowledge} onChange={e => setAcknowledge(e.target.value as '' | 'inspect' | 'rerun')}><option value="">{l('none')}</option><option value="inspect">{l('acknowledgeInspect')}</option><option value="rerun">{l('acknowledgeRerun')}</option></select></label>}
      {matching.length > 1 && <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('node')}<select className={wsField} value={bindingId} onChange={e => setBindingId(e.target.value)}><option value="">{l('none')}</option>{matching.map(b => <option key={b.id} value={b.id}>{nodes.find(n => n.nodeId === b.nodeId)?.name || b.nodeId} · {executorDisplay(employeeExecutor(b.capability) ?? b.capability)}</option>)}</select></label>}
      {reviewerId && <div data-testid="auto-review" className="my-2 space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
        <p className="text-muted-foreground">{l('autoReviewBy').replace('{name}', reviewerName)}</p>
      </div>}
      <details className="mt-3 border-t py-3">
        <summary className="cursor-pointer text-sm font-medium">{l('advancedSettings')}</summary>
        <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('project')}<select className={wsField} disabled={!metadataReady || metadataError} value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">{l('none')}</option>{projectId && !selectedProject && <option disabled value={projectId}>{l('unavailable')}</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {reviewerId && <label className="grid gap-1.5 font-medium">{l('correctionRounds')}<select aria-label={l('correctionRounds')} className={wsField} value={correctionLimit} onChange={e => setCorrectionLimit(e.target.value)}>
          {CORRECTION_CHOICES.map(choice => <option key={choice ?? 'unlimited'} value={choice ?? ''}>{choice == null ? l('correctionUnlimited') : l('correctionRoundsN').replace('{n}', String(choice))}</option>)}
        </select><span className="text-xs font-normal text-muted-foreground">{l('correctionRoundsHint')}</span></label>}
      </details>
    </fieldset>
    <div className="mt-[19px] flex justify-end gap-2">
      {intent.locked ? <Button disabled={busy} onClick={() => void submit(assignMode === true)}>{l('retry')}</Button> : <><Button variant="outline" disabled={busy || (!metadataReady && !metadataError) || !title.trim() || (!!projectId && (metadataError || !selectedProject))} onClick={() => void submit(false)}>{l('onlyCreate')}</Button><Button disabled={busy || !ready || !metadataReady || metadataError || !title.trim() || !employee || !selectedBinding || (!!employee?.previousResultUnknown && !acknowledge)} onClick={() => {if (window.confirm(`${l('sessionHint')}\n${l('privateNotImported')}`)) void submit(true);}}>{l('assign')}</Button></>}
    </div>
  </section>;
}
