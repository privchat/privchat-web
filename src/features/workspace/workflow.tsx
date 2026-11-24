import { FrozenReviewEvidence } from './delivery-summary';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type Binding, type Node, type Project, type WorkExecution, type WorkItem, type WorkNote, type WorkReview, type WorkspaceEmployee } from './api';
import { matchingEmployeeBindings, ReviewEvidenceFields } from './workflow-targets';
import { ConsoleIntent } from './console-intent';
import { CORRECTION_CHOICES, canDevelop, canReview, defaultProjectReviewer, employeeCause, myProjectBindings, otherMemberEmployee, projectDirectory, projectReviewer, workspaceBindingGrant, writableProjectDirectories } from './employee-access';
import { employeeExecutor, executorDisplay } from './employees';
import { isKnownNodeOffline } from './node-connection';
import { workspaceHref } from './routes';
import { roomFailure } from './room-observer';
import { useEmployeePages } from './use-employee-pages';
import { employeeReasonLabel, usePageLabels } from './page-labels';
import { deliveryReceipt, retainBlockedDelivery, isBlocked } from './delivery-receipt';

const field = 'block w-full min-w-0 rounded-[7px] border bg-background px-2.5 py-2 text-sm';
export function WorkflowPanel({api, item, nodes, bindings, notes, readOnly, assignmentOnly = false, onLockChange, onExecution}: {api: WorkspaceApi; item: WorkItem; nodes: Node[]; bindings: Binding[]; notes: WorkNote[]; readOnly: boolean; assignmentOnly?: boolean; onLockChange: (locked: boolean) => void; onExecution: (id: string) => void}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const pageLabel = usePageLabels();
  const employeePages = useEmployeePages(api, item.workspaceId, item.projectId ?? undefined);
  const authorized = employeePages.rows;
  const [project, setProject] = useState<Project>();
  const [projectError, setProjectError] = useState(false);
  const [granted, setGranted] = useState<Binding[]>();
  const [links, setLinks] = useState<WorkExecution[]>([]);
  const [reviews, setReviews] = useState<WorkReview[]>([]);
  const [nodeId, setNodeId] = useState<string>();
  const [reviewerId, setReviewerId] = useState('');
  const [reviewBindingId, setReviewBindingId] = useState('');
  const [employeeId, setEmployeeId] = useState<string>();
  const [bindingId, setBindingId] = useState('');
  const [text, setText] = useState('');
  const [manualReview, setManualReview] = useState(false);
  const [correctionLimit, setCorrectionLimit] = useState('');
  const [acknowledge, setAcknowledge] = useState<'' | 'inspect' | 'rerun'>('');
  const [source, setSource] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [verdict, setVerdict] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [grantError, setGrantError] = useState(false);
  const [blocked, setBlocked] = useState<WorkExecution>();
  const intent = useRef(new ConsoleIntent());
  const operation = useRef<{path: string; body: Record<string, unknown>} | undefined>(undefined);
  const live = useRef(false);
  const running = useRef(false);
  const access = granted ?? bindings;
  const terminal = ['done', 'cancelled'].includes(item.status);
  const employeeName = (id?: string | null) => authorized.find(row => row.employeeId === id)?.name || pageLabel('unnamedEmployee');
  const deviceName = (id?: string | null) => nodes.find(node => node.nodeId === id)?.name || myProjectBindings(project).find(b => b.nodeId === id)?.nodeName || pageLabel('deviceNode');
  const nodeOffline = (id?: string | null) => isKnownNodeOffline(nodes.find(n => n.nodeId === id));
  const fits = (row: WorkspaceEmployee, mode: 'develop' | 'review') => {
    if (otherMemberEmployee(row) || nodeOffline(row.nodeId)) return false;
    const cause = employeeCause(row, access, nodes);
    const usable = row.available || cause === 'bindingMissing' || (mode === 'review' && cause === 'directoryMismatch');
    if (!item.projectId) return usable && !!row.workdirBindingId;
    const allowed = mode === 'review' ? canReview(project, row.nodeId, row.workdirBindingId) : canDevelop(project, row.nodeId, row.workdirBindingId);
    return allowed && usable;
  };
  const workstations = myProjectBindings(project).filter(b => b.nodeId && writableProjectDirectories(project, b.nodeId).length);
  const station = nodeId ?? (workstations.length === 1 ? workstations[0]?.nodeId : undefined);
  const target = (row: WorkspaceEmployee | undefined) => row && ({nodeId: row.nodeId ?? undefined, executor: row.capability?.replace(/^agent\./, '') ?? ''});
  const developers = authorized.filter(row => (!item.projectId || row.nodeId === station) && fits(row, 'develop'));
  const viable = developers.filter(row => row.available && row.employeeId !== projectReviewer(project, row.nodeId) && matchingEmployeeBindings(target(row), access).length);
  const selectedId = employeeId ?? (item.projectId && !employeePages.hasMore && viable.length === 1 ? viable[0]?.employeeId : '');
  const selectedRow = developers.find(row => row.employeeId === selectedId);
  const directory = projectDirectory(project, selectedRow?.nodeId, selectedRow?.workdirBindingId);
  const employee = target(selectedRow);
  const candidates = matchingEmployeeBindings(employee, access);
  const chosenBinding = candidates.length === 1 ? candidates[0]?.id : candidates.find(b => b.id === bindingId)?.id;
  const missingGrant = employee && !candidates.length ? workspaceBindingGrant(employee.nodeId, `agent.${employee.executor}`, access, nodes) : null;
  const sources = links.filter(l => l.state === 'succeeded' && l.executionId && !l.detached && !reviews.some(r => r.reviewerExecution.id === l.id));
  const sourceRow = sources.find(l => l.id === source);
  const sourceProjectBinding = project?.bindings.find(b => b.mine && b.id === sourceRow?.projectBindingId);
  const sourceNode = sourceRow?.nodeId ?? sourceProjectBinding?.nodeId ?? access.find(b => b.id === sourceRow?.bindingId)?.nodeId;
  const reviewers = authorized.filter(row => !!sourceNode && row.nodeId === sourceNode && row.employeeId !== sourceRow?.employeeId &&
    fits(row, 'review') && (!item.projectId || !sourceRow?.workdirBindingId || !row.workdirBindingId || row.workdirBindingId === sourceRow.workdirBindingId) &&
    matchingEmployeeBindings(target(row), access).length > 0);
  const reviewReviewerId = sourceProjectBinding?.reviewerEmployeeId;
  const reviewer = reviewers.find(row => row.employeeId === reviewerId);
  const reviewBindings = matchingEmployeeBindings(target(reviewer), access);
  const chosenReviewBinding = reviewBindings.length === 1 ? reviewBindings[0]?.id : reviewBindings.find(b => b.id === reviewBindingId)?.id;
  const autoReviewer = defaultProjectReviewer(project, selectedRow, authorized, access, nodes);
  const autoReview = !!autoReviewer && !manualReview;
  const locked = busy || intent.current.hasPending;
  const directoryKnown = !item.projectId || !!project || projectError;
  const disabled = locked || readOnly || !ready || !directoryKnown || !employeePages.ready || employeePages.error;
  const selectedReview = reviews.find(r => r.noteId === reviewId);
  const canRecord = !!selectedReview && !selectedReview.conclusion && ['succeeded', 'failed', 'cancelled'].includes(selectedReview.reviewerExecution.state ?? '');
  const needsAcknowledge = !!selectedRow?.previousResultUnknown;
  const cause = selectedRow ? employeeCause(selectedRow, access, nodes) : undefined;
  const canAssign = !!selectedRow?.available && !!text.trim() && !!chosenBinding && !terminal
    && !(needsAcknowledge && !acknowledge);
  const canRequest = !!reviewer && !!sourceRow?.executionId && !!description.trim() && !!chosenReviewBinding && !terminal;
  useEffect(() => {
    if (employeeId === undefined && selectedId) setEmployeeId(selectedId);
  }, [employeeId, selectedId]);
  useEffect(() => {
    let active = true; setProject(undefined); setProjectError(false);
    if (item.projectId) void api.project(item.projectId).then(loaded => {
      if (active) setProject(loaded);
    }).catch(() => {if (active) setProjectError(true);});
    return () => {active = false;};
  }, [api, item.projectId]);
  async function refresh() {
    const [, l, r] = await Promise.all([employeePages.refresh(), api.get<WorkExecution[]>(`/workspace/work-execution/list?workItemId=${encodeURIComponent(item.id)}`), api.get<WorkReview[]>(`/workspace/work-note/review-list?workItemId=${encodeURIComponent(item.id)}`)]);
    if (live.current) {setLinks(l); setReviews(r); setReady(true);}
  }
  useEffect(() => {
    live.current = true; let polling = false;
    const poll = async () => {if (polling) return; polling = true; try {await refresh();} catch (e) {if (live.current) {setError(roomFailure(e) === 'denied' ? 'denied' : 'unsupported'); setReady(false); setLinks([]); setReviews([]);}} finally {polling = false;}};
    void poll(); const timer = setInterval(() => void poll(), 10000);
    return () => {live.current = false; clearInterval(timer); onLockChange(false);};
  }, [api, item.id, item.projectId, employeePages.refresh]);
  async function grant() {
    if (!missingGrant || running.current) return;
    const device = deviceName(missingGrant.nodeId);
    const capability = executorDisplay(employeeExecutor(missingGrant.capability) ?? missingGrant.capability);
    const notice = `${pageLabel('grantNotice').replace('{device}', device).replace('{capability}', capability)}\n${pageLabel('grantConfirm').replace('{device}', device).replace('{capability}', capability)}`;
    if (!window.confirm(notice)) return;
    setBusy(true); setGrantError(false); onLockChange(true);
    try {
      await api.createBinding(item.workspaceId, missingGrant.nodeId, missingGrant.capability);
      const fresh = await api.bindings(item.workspaceId);
      if (live.current) {setGranted(fresh); await employeePages.refresh();}
    } catch {if (live.current) setGrantError(true);}
    finally {if (live.current) {setBusy(false); onLockChange(intent.current.hasPending);}}
  }
  async function submit(path?: string, body?: Record<string, unknown>) {
    if (running.current) return;
    if (path && body && !intent.current.hasPending) operation.current = {path, body};
    const op = operation.current;
    if (!op) return;
    running.current = true; setBusy(true); setError(''); setSaved(false); onLockChange(true);
    try {
      const result = await intent.current.run<WorkExecution | WorkReview>(api, op.path, op.body, 'requestId', retainBlockedDelivery);
      if (!live.current) return;
      const receipt = deliveryReceipt(result);
      if (isBlocked(receipt)) {setBlocked(receipt); return;}
      setBlocked(undefined);
      setSaved(true);
      const execution = receipt.executionId;
      if (execution) onExecution(execution);
      await refresh();
    } catch (e) {if (live.current) setError(roomFailure(e) === 'denied' ? 'denied' : intent.current.hasPending ? 'unknown' : 'itemError');}
    finally {running.current = false; onLockChange(intent.current.hasPending); if (live.current) setBusy(false);}
  }
  return <section data-testid="workflow-panel" className="min-w-0 space-y-3 rounded-[9px] border bg-card p-4">
    <h3 className="text-[17px] font-semibold">{label('employeeWorkflow')}</h3><p className="text-sm text-muted-foreground">{label('workflowHint')}</p>
    {error && <p role="alert" className="text-sm text-destructive">{label(error)}</p>}{saved && <p role="status" className="text-sm text-muted-foreground">{label('workflowSaved')}</p>}
    {grantError && <p role="alert" className="text-sm text-destructive">{pageLabel('grantFailed')}</p>}
    {blocked && <div role="alert" data-testid="delivery-blocked" className="space-y-1 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm"><p>{pageLabel('deliveryBlocked')}</p><p>{pageLabel('deliveryBlockedHint')}</p><p>{pageLabel('requestIdentity')}: {String(intent.current.pendingRequest?.body.requestId ?? '')}</p>{blocked.executionId && <p>{pageLabel('acceptedExecution')}: {blocked.executionId}</p>}</div>}
    {employeePages.error && <><p role="alert" className="text-sm text-destructive">{pageLabel(employeePages.errorCode ?? 'error')}</p><Button size="sm" disabled={locked || employeePages.busy} onClick={() => void employeePages.refresh()}>{pageLabel('retry')}</Button></>}
    {intent.current.hasPending && <div className="space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5"><p className="text-sm">{label('retryRecovery')}</p><Button size="sm" disabled={busy} onClick={() => void submit()}>{label('retrySame')}</Button></div>}
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      {item.projectId && <><p className="text-sm">{pageLabel('project')}: {project?.name ?? pageLabel('unavailable')}</p>
        <label className="grid gap-1.5 text-sm font-medium">{pageLabel('workstation')}<select aria-label={pageLabel('workstation')} className={field} value={station ?? ''} onChange={e => {setNodeId(e.target.value); setEmployeeId(undefined); setBindingId(''); setAcknowledge('');}}>
          <option value="">{pageLabel('none')}</option>{workstations.map(b => <option key={b.id} value={b.nodeId!}>{deviceName(b.nodeId)}{nodeOffline(b.nodeId) ? ` · ${pageLabel('deviceOffline')}` : ''}</option>)}
        </select></label>
        {!!project && !workstations.length && <p className="text-sm"><a className="underline" href={workspaceHref({view: 'project', projectId: project.id})}>{pageLabel('bindFirst')}</a></p>}
        {nodeOffline(station) && <p role="status" className="text-sm">{pageLabel('reasonOffline')}</p>}
        {writableProjectDirectories(project, station).length > 1 && authorized.some(row => row.nodeId === station && !row.workdirBindingId) &&
          <p role="status" className="text-sm">{pageLabel('ambiguousProjectDirectory')}</p>}
      </>}
      <label className="grid gap-1.5 text-sm font-medium">{label('employees')}<select aria-label={label('employees')} className={field} value={selectedRow?.employeeId ?? ''} disabled={!!item.projectId && !station} onChange={e => {setEmployeeId(e.target.value); setBindingId(''); setAcknowledge('');}}><option value="">{label('employees')}</option>{developers.map(row => <option key={row.employeeId} value={row.employeeId}>{employeeName(row.employeeId)} · {executorDisplay(target(row)!.executor)}</option>)}</select></label>
      {project && selectedRow && <p data-testid="assignment-target" className="text-sm font-medium">{project.name} · {deviceName(station)} · {employeeName(selectedRow.employeeId)}</p>}
      {directory && <p data-testid="start-directory" className="text-sm">{pageLabel('colWorkdir')}: {directory.label}</p>}
      {employeePages.hasMore && <Button type="button" variant="outline" disabled={employeePages.busy} onClick={() => void employeePages.more()}>{pageLabel('more')}</Button>}
      {ready && !developers.length && <p role="status" className="text-sm text-muted-foreground">{pageLabel('noLinkedEmployees')}</p>}
      {cause && <p data-testid="employee-unavailable" className="text-sm text-muted-foreground">{pageLabel(employeeReasonLabel[cause])}</p>}
      {missingGrant && <div role="alert" data-testid="grant-binding" className="space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
        <p className="font-medium">{pageLabel('reasonBindingMissing')}</p>
        <p className="text-muted-foreground">{pageLabel('grantNotice').replace('{device}', deviceName(missingGrant.nodeId)).replace('{capability}', executorDisplay(employeeExecutor(missingGrant.capability) ?? missingGrant.capability))}</p>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void grant()}>{pageLabel('grantDeviceAction')}</Button>
      </div>}
      {candidates.length > 1 && <label className="grid gap-1.5 text-sm font-medium">{label('binding')}<select className={field} value={chosenBinding} onChange={e => setBindingId(e.target.value)}><option value="">{label('binding')}</option>{candidates.map(b => <option key={b.id} value={b.id}>{deviceName(b.nodeId)} · {executorDisplay(employeeExecutor(b.capability) ?? b.capability)}</option>)}</select></label>}
      <label className="grid gap-1.5 text-sm font-medium">{label('assignmentText')}<textarea className={field} maxLength={16000} value={text} onChange={e => setText(e.target.value)}/></label>
      {autoReviewer ? <div data-testid="auto-review" className="space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={autoReview} onChange={e => setManualReview(!e.target.checked)}/>{pageLabel('autoReview')}</label>
        <p className="text-muted-foreground">{autoReview ? pageLabel('autoReviewBy').replace('{name}', employeeName(autoReviewer.employeeId)) : pageLabel('manualReviewHint')}</p>
        {autoReview && <details><summary className="cursor-pointer">{pageLabel('advancedSettings')}</summary><label className="grid gap-1.5 font-medium">{pageLabel('correctionRounds')}<select aria-label={pageLabel('correctionRounds')} className={field} value={correctionLimit} onChange={e => setCorrectionLimit(e.target.value)}>
          {CORRECTION_CHOICES.map(choice => <option key={choice ?? 'default'} value={choice ?? ''}>{choice == null ? pageLabel('correctionDefault') : pageLabel('correctionRoundsN').replace('{n}', String(choice))}</option>)}
        </select><span className="text-xs font-normal text-muted-foreground">{pageLabel('correctionRoundsHint')}</span></label></details>}
      </div> : selectedRow && project && <p className="text-sm text-muted-foreground">{pageLabel('noEligibleReviewer')} <a className="underline" href={workspaceHref({view: 'project', projectId: project.id})}>{pageLabel('configureReviewer')}</a></p>}
      {needsAcknowledge && <label className="grid gap-1.5 text-sm font-medium">{pageLabel('acknowledgeUnknown')}<select className={field} value={acknowledge} onChange={e => setAcknowledge(e.target.value as '' | 'inspect' | 'rerun')}><option value="">{label('none')}</option><option value="inspect">{pageLabel('acknowledgeInspect')}</option><option value="rerun">{pageLabel('acknowledgeRerun')}</option></select></label>}
      <Button disabled={!canAssign} onClick={() => {if (window.confirm(label('confirm'))) void submit('/workspace/work-execution/assign', {workItemId: item.id, version: item.version, bindingId: chosenBinding, employeeId: selectedId, text, autoReview, ...(autoReview ? {correctionLimit: correctionLimit === '' ? null : Number(correctionLimit)} : {}), ...(needsAcknowledge && acknowledge ? {acknowledgeUnknown: acknowledge} : {})});}}>{item.projectId && selectedRow && !autoReview ? pageLabel('assignExistingManually') : label('assignEmployee')}</Button>
      {!assignmentOnly && <>
      <h4>{label('requestReview')}</h4>
      <ReviewEvidenceFields links={sources} notes={notes} employeeName={employeeName} source={source} onSource={id => {setSource(id); setReviewerId(''); setReviewBindingId('');}} description={description} onDescription={setDescription} evidence={evidence} onEvidence={setEvidence}/>
      {reviewReviewerId && <Button type="button" variant="outline" data-testid="default-reviewer" disabled={!reviewers.some(row => row.employeeId === reviewReviewerId)} onClick={() => {setReviewerId(reviewReviewerId); setReviewBindingId('');}}>{pageLabel('defaultReviewer')}: {employeeName(reviewReviewerId)}</Button>}
      <label className="grid gap-1.5 text-sm font-medium">{pageLabel('reviewEmployee')}<select aria-label={pageLabel('reviewEmployee')} className={field} disabled={!reviewers.length} value={reviewer?.employeeId ?? ''} onChange={e => {setReviewerId(e.target.value); setReviewBindingId('');}}><option value="">{pageLabel('none')}</option>{reviewers.map(row => <option key={row.employeeId} value={row.employeeId}>{employeeName(row.employeeId)}</option>)}</select></label>
      {sourceRow && !reviewers.length && <p role="status" className="text-sm">{pageLabel('noEligibleReviewer')}</p>}
      {reviewBindings.length > 1 && <label className="grid gap-1.5 text-sm font-medium">{label('binding')}<select className={field} value={reviewBindingId} onChange={e => setReviewBindingId(e.target.value)}><option value="">{label('none')}</option>{reviewBindings.map(b => <option key={b.id} value={b.id}>{deviceName(b.nodeId)} · {executorDisplay(employeeExecutor(b.capability) ?? b.capability)}</option>)}</select></label>}
      <label className="grid gap-1.5 text-sm font-medium">{label('reviewInstructions')}<textarea className={field} maxLength={4000} value={instructions} onChange={e => setInstructions(e.target.value)}/></label>
      <Button disabled={!canRequest} onClick={() => {if (window.confirm(label('confirm'))) void submit('/workspace/work-note/request-review', {workItemId: item.id, version: item.version, sourceWorkExecutionId: source, evidenceNoteIds: evidence, evidenceDescription: description, reviewerEmployeeId: reviewer?.employeeId, reviewerBindingId: chosenReviewBinding, instructions});}}>{label('requestReview')}</Button>
      <h4>{label('reviewRecords')}</h4>
      {reviews.map(r => <article key={r.noteId} className="space-y-1 rounded-[8px] border bg-sidebar p-3 text-sm break-words">
        <p className="font-medium">{employeeName(r.reviewerEmployeeId)} · {new Date(r.createdAt).toLocaleString()}</p>
        <p className="text-muted-foreground">{label(`execution_${r.reviewerExecution.state}`)} · {r.conclusion ? (r.conclusion === 'passed' ? label('reviewPassed') : r.conclusion === 'changes_requested' ? label('changesRequested') : r.conclusion) : label('awaitingVerdict')}</p>
        <FrozenReviewEvidence review={r} notes={notes}/>
        {r.conclusionBody && <p className="whitespace-pre-wrap">{label('reviewReason')}: {r.conclusionBody}</p>}
        {r.reviewerExecution.executionId && <Button variant="outline" size="sm" onClick={() => onExecution(r.reviewerExecution.executionId!)}>{label('openReviewSession')}</Button>}
      </article>)}
      <label className="grid gap-1.5 text-sm font-medium">{label('recordReview')}<select className={field} value={reviewId} onChange={e => {setReviewId(e.target.value); setConclusion(''); setVerdict('');}}><option value="">{label('reviewRecords')}</option>{reviews.filter(r => !r.conclusion).map(r => <option key={r.noteId} value={r.noteId}>{employeeName(r.reviewerEmployeeId)} · {new Date(r.createdAt).toLocaleString()}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-medium">{label('reviewConclusion')}<select className={field} value={conclusion} onChange={e => setConclusion(e.target.value)}><option value="">{label('none')}</option><option value="changes_requested">{label('changesRequested')}</option><option value="passed" disabled={selectedReview?.reviewerExecution.state !== 'succeeded'}>{label('reviewPassed')}</option></select></label>
      <label className="grid gap-1.5 text-sm font-medium">{label('reviewReason')}<textarea className={field} maxLength={20000} value={verdict} onChange={e => setVerdict(e.target.value)}/></label>
      <Button disabled={!canRecord || !conclusion || !verdict.trim() || (conclusion === 'passed' && selectedReview?.reviewerExecution.state !== 'succeeded')} onClick={() => {if (window.confirm(label('verdictConfirm'))) void submit('/workspace/work-note/record-review', {reviewNoteId: reviewId, conclusion, body: verdict});}}>{label('recordReview')}</Button>
      </>}
    </fieldset>
  </section>;
}
