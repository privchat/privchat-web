import { isBlocked } from './delivery-receipt';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Binding, Node, Project, WorkspaceApi } from './api';
import { taskSetupDraft, workspaceItemIntent } from './create-item-storage';
import { employeeReasonLabel, usePageLabels } from './page-labels';
import { wsField } from './shell';
import { useEmployeePages } from './use-employee-pages';
import { employeeExecutor, executorDisplay } from './employees';
import { CORRECTION_CHOICES, canDevelop, defaultProjectReviewer, employeeCause, grantableWorkspaceBinding, myProjectBindings, otherMemberEmployee, projectDirectory, projectReviewer, writableProjectDirectories } from './employee-access';
import { isKnownNodeOffline } from './node-connection';
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
  const sameDraftProject = !intent.input && restoredDraft?.projectId === projectId;
  const [nodeId, setNodeId] = useState(sameDraftProject ? restoredDraft?.nodeId ?? '' : '');
  const [employeeId, setEmployeeId] = useState(intent.assignment?.employeeId ?? (sameDraftProject ? restoredDraft?.employeeId ?? '' : ''));
  const [bindingId, setBindingId] = useState('');
  const [correctionLimit, setCorrectionLimit] = useState(intent.input ? String(intent.assignment?.correctionLimit ?? '') : restoredDraft?.correctionLimit ?? '');
  const [manualReview, setManualReview] = useState(restoredDraft?.manualReview === true);
  const [acknowledge, setAcknowledge] = useState<'' | 'inspect' | 'rerun'>('');
  const [grantError, setGrantError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const ready = employeePages.ready && !employeePages.error;
  const [assignMode, setAssignMode] = useState<boolean>();
  const running = useRef(false);
  const live = useRef(true);
  const nodeChosen = useRef(sameDraftProject && restoredDraft?.nodeId !== undefined);
  const employeeChosen = useRef(sameDraftProject && restoredDraft?.employeeId !== undefined);
  const selectedProject = projects.find(p => p.id === projectId);
  const workstations = myProjectBindings(selectedProject).filter(b => b.nodeId && writableProjectDirectories(selectedProject, b.nodeId).length);
  const selectedStation = workstations.find(b => b.nodeId === nodeId);
  const nodeOffline = (id?: string | null) => isKnownNodeOffline(nodes.find(n => n.nodeId === id));
  const nodeName = (id?: string | null) => nodes.find(n => n.nodeId === id)?.name ?? workstations.find(b => b.nodeId === id)?.nodeName ?? id;
  const nodeRows = selectedStation ? employees.filter(e => e.nodeId === nodeId && !otherMemberEmployee(e)) : [];
  const candidates = nodeRows.filter(e => canDevelop(selectedProject, e.nodeId, e.workdirBindingId));
  const row = candidates.find(e => e.employeeId === employeeId);
  const employee = row?.available && !nodeOffline(nodeId) ? row : undefined;
  const unbound = !!selectedProject && !workstations.length;
  const ambiguousDirectory = writableProjectDirectories(selectedProject, nodeId).length > 1 && nodeRows.some(e => !e.workdirBindingId);
  const reviewer = defaultProjectReviewer(selectedProject, row, employees, bindings, nodes);
  const autoReview = intent.locked ? intent.assignment?.autoReview === true : !!reviewer && !manualReview;
  const directory = projectDirectory(selectedProject, row?.nodeId, row?.workdirBindingId);
  const matching = (bindings ?? []).filter(b => b.revoked === 0 && b.nodeId === employee?.nodeId && b.capability === employee?.capability);
  const selectedBinding = matching.length === 1 ? matching[0]?.id : matching.find(b => b.id === bindingId)?.id;
  const locked = busy || intent.locked;
  const noWorkstation = nodesKnown && !nodes.some(node => node.revokedAt == null);
  function openSetup(route: WorkspaceRoute) {
    if (!storage.save({title, description, acceptance, projectId,
      nodeId: nodeId || nodeChosen.current ? nodeId : undefined,
      employeeId: employeeId || employeeChosen.current ? employeeId : undefined,
      correctionLimit, manualReview})) {setDraftError(true); return;}
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
    // A failed device lookup must not be mistaken for an offline workstation.
    try {const list = await api.nodes(); if (live.current) {setNodes(list); setNodesKnown(true);}} catch { /* Do not infer missing devices. */ }
  }
  useEffect(() => {live.current = true; void loadMetadata(); return () => {live.current = false;};}, [api, workspaceId]);
  function clearEmployee() {
    employeeChosen.current = false;
    setEmployeeId(''); setBindingId(''); setAcknowledge('');
  }
  function changeProject(id: string) {
    nodeChosen.current = false;
    setProjectId(id); setNodeId(''); clearEmployee();
  }
  useEffect(() => {
    if (intent.input || !metadataReady) return;
    if (nodeId && !selectedStation) {
      setNodeId(''); clearEmployee();
    } else if (!nodeId && !nodeChosen.current && workstations.length === 1) {
      setNodeId(workstations[0]?.nodeId ?? '');
    }
  }, [intent.input, metadataReady, nodeId, selectedStation, workstations.length]);
  useEffect(() => {
    if (intent.input || !nodeId || !ready || employeePages.hasMore) return;
    if (employeeId && !row) {
      clearEmployee();
    } else if (!employeeChosen.current && !employeeId && !nodeOffline(nodeId)) {
      const reviewerId = projectReviewer(selectedProject, nodeId);
      const available = candidates.filter(e => e.available && e.employeeId !== reviewerId &&
        bindings?.some(b => b.revoked === 0 && b.nodeId === e.nodeId && b.capability === e.capability));
      if (available.length === 1) setEmployeeId(available[0]!.employeeId);
    }
  }, [employees, employeeId, nodeId, nodes, bindings, ready, selectedProject, employeePages.hasMore]);
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
        autoReview, ...(autoReview ? {correctionLimit: correctionLimit === '' ? null : Number(correctionLimit)} : {}),
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
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('project')}<select className={wsField} disabled={!metadataReady || metadataError} value={projectId} onChange={e => changeProject(e.target.value)}><option value="">{l('none')}</option>{projectId && !selectedProject && <option disabled value={projectId}>{l('unavailable')}</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('workstation')}<select aria-label={l('workstation')} className={wsField} disabled={!workstations.length} value={nodeId} onChange={e => {nodeChosen.current = true; setNodeId(e.target.value); clearEmployee();}}>
        <option value="">{l('none')}</option>
        {workstations.map(b => <option key={b.id} value={b.nodeId!}>{nodeName(b.nodeId)}{nodeOffline(b.nodeId) ? ` · ${l('deviceOffline')}` : ''}</option>)}
      </select></label>
      {nodeOffline(nodeId) && <p role="status" className="text-sm text-muted-foreground">{l('reasonOffline')}</p>}

      {noWorkstation && <div className="my-2 space-y-2 rounded-lg border bg-sidebar p-3 text-sm">
        <p>{l('taskConnectHint')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => openSetup({view: 'devices'})}>{l('taskConnectDevice')}</Button>
      </div>}
      {!noWorkstation && unbound && metadataReady && !metadataError && <div role="alert" data-testid="bind-project-first" className="my-2 space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
        <p className="font-medium">{l('bindFirst')}</p><p className="text-muted-foreground">{l('bindFirstHint')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => openSetup({view: 'project', projectId})}>{l('bindMyDirs')}</Button>
      </div>}
      <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('employee')}<select aria-label={l('employee')} className={wsField} disabled={!ready || !selectedStation || candidates.length === 0} value={employeeId} onChange={e => {employeeChosen.current = true; setEmployeeId(e.target.value); setBindingId(''); setAcknowledge('');}}><option value="">{l('none')}</option>{candidates.map(e => {
        const hint = note(e.employeeId);
        return <option key={e.employeeId} value={e.employeeId} disabled={!e.available}>{e.name || l('unnamedEmployee')}{hint && ` · ${hint}`}</option>;
      })}</select><span className="text-xs font-normal text-muted-foreground">{l('linkedEmployeeHint')}</span></label>
      {!noWorkstation && !ambiguousDirectory && !!selectedStation && ready && metadataReady && !metadataError && !employeePages.hasMore && candidates.length === 0 && <div className="space-y-2 pb-2 text-sm text-muted-foreground">
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
      {ambiguousDirectory && <div className="space-y-2 py-2 text-sm text-muted-foreground">
        <p role="status">{l('ambiguousProjectDirectory')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => openSetup({view: 'project', projectId})}>{l('bindMyDirs')}</Button>
      </div>}
      {row && <p data-testid="assignment-target" className="py-2 text-sm font-medium">{selectedProject?.name} · {nodeName(nodeId)} · {row.name || l('unnamedEmployee')}</p>}
      {employee && directory && <p data-testid="start-directory" className="text-sm text-muted-foreground">
        {l('colWorkdir')}: {directory.label} · {l(directory.access === 'write' ? 'accessWrite' : 'accessRead')}
      </p>}
      {employee?.previousResultUnknown && <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('acknowledgeUnknown')}<select className={wsField} value={acknowledge} onChange={e => setAcknowledge(e.target.value as '' | 'inspect' | 'rerun')}><option value="">{l('none')}</option><option value="inspect">{l('acknowledgeInspect')}</option><option value="rerun">{l('acknowledgeRerun')}</option></select></label>}
      {matching.length > 1 && <label className="grid gap-1.5 py-[13px] text-sm font-medium">{l('binding')}<select className={wsField} value={bindingId} onChange={e => setBindingId(e.target.value)}><option value="">{l('none')}</option>{matching.map(b => <option key={b.id} value={b.id}>{nodes.find(n => n.nodeId === b.nodeId)?.name || b.nodeId} · {executorDisplay(employeeExecutor(b.capability) ?? b.capability)}</option>)}</select></label>}
      {(employee || intent.assignment) && <div data-testid="auto-review" className="my-2 space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
        <p className="text-muted-foreground">{autoReview ? (intent.locked ? l('autoReview') : l('autoReviewBy').replace('{name}', reviewer?.name || l('unnamedEmployee'))) : !intent.locked && !reviewer ? l('noEligibleReviewer') : l('manualReviewHint')}</p>
        {!intent.locked && !reviewer && projectId && <Button type="button" variant="outline" size="sm" onClick={() => openSetup({view: 'project', projectId})}>{l('configureReviewer')}</Button>}
      </div>}
      <details className="mt-3 border-t py-3">
        <summary className="cursor-pointer text-sm font-medium">{l('advancedSettings')}</summary>
        <label className="flex items-center gap-2 py-2 text-sm font-medium"><input type="checkbox" checked={autoReview} disabled={!reviewer} onChange={e => setManualReview(!e.target.checked)}/>{l('autoReview')}</label>
        {autoReview && <label className="grid gap-1.5 font-medium">{l('correctionRounds')}<select aria-label={l('correctionRounds')} className={wsField} value={correctionLimit} onChange={e => setCorrectionLimit(e.target.value)}>
          {CORRECTION_CHOICES.map(choice => <option key={choice ?? 'unlimited'} value={choice ?? ''}>{choice == null ? l('correctionUnlimited') : l('correctionRoundsN').replace('{n}', String(choice))}</option>)}
        </select><span className="text-xs font-normal text-muted-foreground">{l('correctionRoundsHint')}</span></label>}
      </details>
    </fieldset>
    <div className="mt-[19px] flex justify-end gap-2">
      {intent.locked ? <Button disabled={busy} onClick={() => void submit(assignMode === true)}>{l('retry')}</Button> : <><Button variant="outline" disabled={busy || (!metadataReady && !metadataError) || !title.trim() || (!!projectId && (metadataError || !selectedProject))} onClick={() => void submit(false)}>{l('onlyCreate')}</Button><Button disabled={busy || !ready || !metadataReady || metadataError || !title.trim() || !employee || !selectedBinding || (!!employee?.previousResultUnknown && !acknowledge)} onClick={() => {if (window.confirm(`${l('sessionHint')}\n${l('privateNotImported')}`)) void submit(true);}}>{l(employee && !autoReview ? 'assignManually' : 'assign')}</Button></>}
    </div>
  </section>;
}
