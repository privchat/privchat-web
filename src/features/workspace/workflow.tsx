import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type Binding, type Node, type Project, type WorkExecution, type WorkItem, type WorkNote, type WorkReview, type WorkspaceEmployee } from './api';
import { matchingEmployeeBindings, ReviewEvidenceFields } from './workflow-targets';
import { ConsoleIntent } from './console-intent';
import { CORRECTION_CHOICES, canDevelop, canReview, employeeCause, myProjectBindings, otherMemberEmployee, projectReviewer, workspaceBindingGrant } from './employee-access';
import { employeeExecutor, executorDisplay } from './employees';
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
  const [employeeId, setEmployeeId] = useState('');
  const [bindingId, setBindingId] = useState('');
  const [text, setText] = useState('');
  const [autoReview, setAutoReview] = useState(false);
  const [correctionLimit, setCorrectionLimit] = useState('');
  const [acknowledge, setAcknowledge] = useState<'' | 'inspect' | 'rerun'>('');
  const [source, setSource] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [conclusion, setConclusion] = useState('changes_requested');
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
  const deviceName = (id?: string | null) => nodes.find(node => node.nodeId === id)?.name || pageLabel('deviceNode');
  // Developing needs the start directory writable in my binding on its computer; reviewing only needs it bound (§20.5).
  const fits = (row: WorkspaceEmployee, mode: 'develop' | 'review') => {
    const cause = employeeCause(row, access, nodes);
    // A binding only I can grant stays reachable so it can be granted here; a read-only start directory only blocks development.
    const usable = row.available || cause === 'bindingMissing' || (mode === 'review' && cause === 'directoryMismatch');
    if (!item.projectId || !project) return usable;
    const allowed = mode === 'review' ? canReview(project, row.nodeId, row.workdirBindingId) : canDevelop(project, row.nodeId, row.workdirBindingId);
    return allowed && usable;
  };
  const selectable = authorized.filter(row => !otherMemberEmployee(row) && (fits(row, 'develop') || fits(row, 'review')));
  const employees = selectable.map(row => ({agentId: row.employeeId, name: row.name || pageLabel('unnamedEmployee'), nodeId: row.nodeId ?? undefined, executor: row.capability?.replace(/^agent\./, '') ?? '', workdirBindingId: row.workdirBindingId ?? '', reviewOnly: !fits(row, 'develop')}));
  const employee = employees.find(e => e.agentId === employeeId);
  const selectedRow = authorized.find(row => row.employeeId === employeeId);
  const candidates = matchingEmployeeBindings(employee, access);
  const chosenBinding = candidates.length === 1 ? candidates[0]!.id : bindingId;
  const missingGrant = employee && !candidates.length ? workspaceBindingGrant(employee.nodeId, `agent.${employee.executor}`, access, nodes) : null;
  const sourceRow = links.find(l => l.id === source);
  const sources = links.filter(l => l.state === 'succeeded' && l.executionId && !reviews.some(r => r.reviewerExecution.id === l.id));
  // The reviewer named in my binding where the work runs: the developer's computer, or the reviewed round's binding (§20.3).
  const autoReviewerId = [projectReviewer(project, employee?.nodeId)].find(id => !!id && id !== employeeId);
  const reviewReviewerId = [
    project?.bindings.find(b => b.mine && !!sourceRow?.projectBindingId && b.id === sourceRow.projectBindingId)?.reviewerEmployeeId,
    myProjectBindings(project)[0]?.reviewerEmployeeId,
  ].find(id => !!id && id !== sourceRow?.employeeId);
  const canAutoReview = !!autoReviewerId && !!employeeId;
  const locked = busy || intent.current.hasPending;
  const directoryKnown = !item.projectId || !!project || projectError;
  const disabled = locked || readOnly || !ready || !directoryKnown || !employeePages.ready || employeePages.error;
  const selectedReview = reviews.find(r => r.noteId === reviewId);
  const canRecord = !!selectedReview && !selectedReview.conclusion && ['succeeded', 'failed', 'cancelled'].includes(selectedReview.reviewerExecution.state ?? '');
  const needsAcknowledge = !!selectedRow?.previousResultUnknown;
  const cause = selectedRow ? employeeCause(selectedRow, access, nodes) : undefined;
  const canAssign = !!selectedRow && fits(selectedRow, 'develop') && !!text.trim() && !!chosenBinding && !terminal
    && !(autoReview && !canAutoReview) && !(needsAcknowledge && !acknowledge);
  const canRequest = !!selectedRow && fits(selectedRow, 'review') && selectedRow.employeeId !== sourceRow?.employeeId
    && !!sourceRow?.executionId && sourceRow.state === 'succeeded' && !!description.trim() && !!chosenBinding && !terminal;
  useEffect(() => {
    let active = true; setProject(undefined); setProjectError(false);
    if (item.projectId) void api.project(item.projectId).then(loaded => {
      if (active) setProject(loaded);
    }).catch(() => {if (active) setProjectError(true);});
    return () => {active = false;};
  }, [api, item.projectId]);
  // Choosing another developer decides the review again, as on the create page (§19.6).
  useEffect(() => {setAutoReview(canAutoReview);}, [canAutoReview]);
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
      <label className="grid gap-1.5 text-sm font-medium">{label('employees')}<select className={field} value={employeeId} onChange={e => {setEmployeeId(e.target.value); setBindingId(''); setAcknowledge('');}}><option value="">{label('employees')}</option>{employees.map(e => <option key={e.agentId} value={e.agentId}>{e.name} · {executorDisplay(e.executor)}{e.reviewOnly && ` · ${pageLabel('reviewOnly')}`}</option>)}</select></label>
      {employeePages.hasMore && <Button type="button" variant="outline" disabled={employeePages.busy} onClick={() => void employeePages.more()}>{pageLabel('more')}</Button>}
      {ready && !employees.length && <p role="status" className="text-sm text-muted-foreground">{pageLabel('noLinkedEmployees')}</p>}
      {cause && <p data-testid="employee-unavailable" className="text-sm text-muted-foreground">{pageLabel(employeeReasonLabel[cause])}</p>}
      {missingGrant && <div role="alert" data-testid="grant-binding" className="space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
        <p className="font-medium">{pageLabel('reasonBindingMissing')}</p>
        <p className="text-muted-foreground">{pageLabel('grantNotice').replace('{device}', deviceName(missingGrant.nodeId)).replace('{capability}', executorDisplay(employeeExecutor(missingGrant.capability) ?? missingGrant.capability))}</p>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void grant()}>{pageLabel('grantDeviceAction')}</Button>
      </div>}
      {candidates.length > 0 && <label className="grid gap-1.5 text-sm font-medium">{label('binding')}<select className={field} value={chosenBinding} onChange={e => setBindingId(e.target.value)}>{candidates.length > 1 && <option value="">{label('binding')}</option>}{candidates.map(b => <option key={b.id} value={b.id}>{deviceName(b.nodeId)} · {executorDisplay(employeeExecutor(b.capability) ?? b.capability)}</option>)}</select></label>}
      <label className="grid gap-1.5 text-sm font-medium">{label('assignmentText')}<textarea className={field} maxLength={16000} value={text} onChange={e => setText(e.target.value)}/></label>
      {autoReviewerId ? <div data-testid="auto-review" className="space-y-2 rounded-[8px] border bg-sidebar px-3 py-2.5 text-sm">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={autoReview} disabled={!canAutoReview} onChange={e => setAutoReview(e.target.checked)}/>{pageLabel('autoReview')}</label>
        <p className="text-muted-foreground">{canAutoReview ? pageLabel('autoReviewBy').replace('{name}', employeeName(autoReviewerId)) : pageLabel('selfReviewHint')}</p>
        {autoReview && canAutoReview && <label className="grid gap-1.5 font-medium">{pageLabel('correctionRounds')}<select aria-label={pageLabel('correctionRounds')} className={field} value={correctionLimit} onChange={e => setCorrectionLimit(e.target.value)}>
          {CORRECTION_CHOICES.map(choice => <option key={choice ?? 'unlimited'} value={choice ?? ''}>{choice == null ? pageLabel('correctionUnlimited') : pageLabel('correctionRoundsN').replace('{n}', String(choice))}</option>)}
        </select><span className="text-xs font-normal text-muted-foreground">{pageLabel('correctionRoundsHint')}</span></label>}
      </div> : <p className="text-sm text-muted-foreground">{pageLabel('autoReviewHint')}</p>}
      {needsAcknowledge && <label className="grid gap-1.5 text-sm font-medium">{pageLabel('acknowledgeUnknown')}<select className={field} value={acknowledge} onChange={e => setAcknowledge(e.target.value as '' | 'inspect' | 'rerun')}><option value="">{label('none')}</option><option value="inspect">{pageLabel('acknowledgeInspect')}</option><option value="rerun">{pageLabel('acknowledgeRerun')}</option></select></label>}
      <Button disabled={!canAssign} onClick={() => {if (window.confirm(label('confirm'))) void submit('/workspace/work-execution/assign', {workItemId: item.id, version: item.version, bindingId: chosenBinding, employeeId, text, autoReview: autoReview && canAutoReview, ...(autoReview && canAutoReview ? {correctionLimit: correctionLimit === '' ? null : Number(correctionLimit)} : {}), ...(needsAcknowledge && acknowledge ? {acknowledgeUnknown: acknowledge} : {})});}}>{label('assignEmployee')}</Button>
      {!assignmentOnly && <>
      <h4>{label('requestReview')}</h4>
      {reviewReviewerId && <Button type="button" variant="outline" data-testid="default-reviewer" disabled={!employees.some(e => e.agentId === reviewReviewerId)} onClick={() => {setEmployeeId(reviewReviewerId); setBindingId(''); setAcknowledge('');}}>{pageLabel('defaultReviewer')}: {employeeName(reviewReviewerId)}</Button>}
      <ReviewEvidenceFields links={sources} notes={notes} employeeName={employeeName} source={source} onSource={setSource} description={description} onDescription={setDescription} evidence={evidence} onEvidence={setEvidence}/>
      <label className="grid gap-1.5 text-sm font-medium">{label('reviewInstructions')}<textarea className={field} maxLength={4000} value={instructions} onChange={e => setInstructions(e.target.value)}/></label>
      <Button disabled={!canRequest} onClick={() => {if (window.confirm(label('confirm'))) void submit('/workspace/work-note/request-review', {workItemId: item.id, version: item.version, sourceWorkExecutionId: source, evidenceNoteIds: evidence, evidenceDescription: description, reviewerEmployeeId: employeeId, reviewerBindingId: chosenBinding, instructions});}}>{label('requestReview')}</Button>
      <h4>{label('reviewRecords')}</h4>
      {reviews.map(r => <article key={r.noteId} className="space-y-1 rounded-[8px] border bg-sidebar p-3 text-sm break-words">
        <p className="font-medium">{employeeName(r.reviewerEmployeeId)} · {new Date(r.createdAt).toLocaleString()}</p>
        <p className="text-muted-foreground">{label(`execution_${r.reviewerExecution.state}`)} · {r.conclusion ? label(r.conclusion === 'passed' ? 'reviewPassed' : 'changesRequested') : label('awaitingVerdict')}</p>
        <p className="whitespace-pre-wrap">{r.evidenceDescription}</p><p className="whitespace-pre-wrap">{r.conclusionBody}</p>
        {r.reviewerExecution.executionId && <Button variant="outline" size="sm" onClick={() => onExecution(r.reviewerExecution.executionId!)}>{label('openReviewSession')}</Button>}
      </article>)}
      <label className="grid gap-1.5 text-sm font-medium">{label('recordReview')}<select className={field} value={reviewId} onChange={e => {setReviewId(e.target.value); setConclusion('changes_requested');}}><option value="">{label('reviewRecords')}</option>{reviews.filter(r => !r.conclusion).map(r => <option key={r.noteId} value={r.noteId}>{employeeName(r.reviewerEmployeeId)} · {new Date(r.createdAt).toLocaleString()}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-medium">{label('reviewConclusion')}<select className={field} value={conclusion} onChange={e => setConclusion(e.target.value)}><option value="changes_requested">{label('changesRequested')}</option><option value="passed" disabled={selectedReview?.reviewerExecution.state !== 'succeeded'}>{label('reviewPassed')}</option></select></label>
      <label className="grid gap-1.5 text-sm font-medium">{label('reviewReason')}<textarea className={field} maxLength={20000} value={verdict} onChange={e => setVerdict(e.target.value)}/></label>
      <Button disabled={!canRecord || !verdict.trim() || (conclusion === 'passed' && selectedReview?.reviewerExecution.state !== 'succeeded')} onClick={() => {if (window.confirm(label('verdictConfirm'))) void submit('/workspace/work-note/record-review', {reviewNoteId: reviewId, conclusion, body: verdict});}}>{label('recordReview')}</Button>
      </>}
    </fieldset>
  </section>;
}
