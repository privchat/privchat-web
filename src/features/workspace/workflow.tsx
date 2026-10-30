import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type Binding, type Node, type WorkExecution, type WorkItem, type WorkNote, type WorkReview } from './api';
import { matchingEmployeeBindings, ReviewEvidenceFields } from './workflow-targets';
import { ConsoleIntent } from './console-intent';
import { roomFailure } from './room-observer';
import { useEmployeePages } from './use-employee-pages';
import { usePageLabels } from './page-labels';
import { deliveryReceipt, retainBlockedDelivery, isBlocked } from './delivery-receipt';

const field = 'block w-full min-w-0 rounded border bg-background px-3 py-2 text-sm';
export function WorkflowPanel({api, item, nodes, bindings, notes, readOnly, onLockChange, onExecution}: {api: WorkspaceApi; item: WorkItem; nodes: Node[]; bindings: Binding[]; notes: WorkNote[]; readOnly: boolean; onLockChange: (locked: boolean) => void; onExecution: (id: string) => void}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const pageLabel = usePageLabels();
  const employeePages = useEmployeePages(api, item.workspaceId, item.projectId ?? undefined);
  const authorized = employeePages.rows;
  const employees = authorized.filter(row => row.available).map(row => ({agentId: row.employeeId, name: row.name ?? row.employeeId, nodeId: row.nodeId ?? undefined, executor: row.capability?.replace(/^agent\./, '') ?? '', config: {}, createdAt: 0, roleDescription: row.roleDescription ?? '', title: row.roleDescription ?? '', model: row.model ?? '', workdirBindingId: row.workdirBindingId ?? ''}));
  const [projectTargetId, setProjectTargetId] = useState('');
  const [links, setLinks] = useState<WorkExecution[]>([]);
  const [reviews, setReviews] = useState<WorkReview[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [defaultReviewer, setDefaultReviewer] = useState<string>();
  const [bindingId, setBindingId] = useState('');
  const [text, setText] = useState('');
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
  const [blocked, setBlocked] = useState<WorkExecution>();
  const intent = useRef(new ConsoleIntent());
  const operation = useRef<{path: string; body: Record<string, unknown>} | undefined>(undefined);
  const live = useRef(false);
  const running = useRef(false);
  const employee = employees.find(e => e.agentId === employeeId);
  const authorizedEmployee = authorized.find(e => e.employeeId === employeeId && e.available);
  const projectTargets = authorizedEmployee?.projectTargetIds ?? [];
  const selectedTarget = projectTargets.length === 1 ? projectTargets[0] : projectTargetId;
  const candidates = matchingEmployeeBindings(employee, bindings, nodes);
  const locked = busy || intent.current.hasPending;
  const disabled = locked || readOnly || !ready || !employeePages.ready || employeePages.error;
  const selectedReview = reviews.find(r => r.noteId === reviewId);
  const canRecord = !!selectedReview && !selectedReview.conclusion && ['succeeded', 'failed', 'cancelled'].includes(selectedReview.reviewerExecution.state ?? '');
  useEffect(() => {
    let active = true; setDefaultReviewer(undefined);
    if (item.projectId) void api.project(item.projectId).then(project => {
      // The default reviewer works where this turn works: the selected directory's reviewer.
      if (active) setDefaultReviewer(project.targets.find(t => t.id === selectedTarget)?.reviewerEmployeeId
        ?? (project.targets.length === 1 ? project.targets[0]?.reviewerEmployeeId : undefined) ?? undefined);
    }).catch(() => {});
    return () => {active = false;};
  }, [api, item.projectId, selectedTarget]);
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
  return <section data-testid="workflow-panel" className="min-w-0 space-y-3 rounded border p-3">
    <h3 className="font-semibold">{label('employeeWorkflow')}</h3><p className="text-sm">{label('workflowHint')}</p>
    {error && <p role="alert">{label(error)}</p>}{saved && <p role="status">{label('workflowSaved')}</p>}
    {blocked && <div role="alert" data-testid="delivery-blocked" className="space-y-1"><p>{pageLabel('deliveryBlocked')}</p><p>{pageLabel('deliveryBlockedHint')}</p><p>{pageLabel('requestIdentity')}: {String(intent.current.pendingRequest?.body.requestId ?? '')}</p>{blocked.executionId && <p>{pageLabel('acceptedExecution')}: {blocked.executionId}</p>}</div>}
    {employeePages.error && <><p role="alert">{pageLabel(employeePages.errorCode ?? 'error')}</p><Button disabled={locked || employeePages.busy} onClick={() => void employeePages.refresh()}>{pageLabel('retry')}</Button></>}
    {intent.current.hasPending && <><p>{label('retryRecovery')}</p><Button disabled={busy} onClick={() => void submit()}>{label('retrySame')}</Button></>}
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <label className="block">{label('employees')}<select className={field} value={employeeId} onChange={e => {setEmployeeId(e.target.value); setBindingId(''); setProjectTargetId('');}}><option value="">{label('employees')}</option>{employees.map(e => <option key={e.agentId} value={e.agentId}>{e.name} · {e.title}</option>)}</select></label>
      {employeePages.hasMore && <Button type="button" variant="outline" disabled={employeePages.busy} onClick={() => void employeePages.more()}>{pageLabel('more')}</Button>}
      {projectTargets.length > 1 && <label className="block">{label('workdir')}<select className={field} value={projectTargetId} onChange={e => setProjectTargetId(e.target.value)}><option value="">{label('workdir')}</option>{projectTargets.map(id => <option key={id} value={id}>{id}</option>)}</select></label>}
      <label className="block">{label('binding')}<select className={field} value={bindingId} onChange={e => setBindingId(e.target.value)}><option value="">{label('binding')}</option>{candidates.map(b => <option key={b.id} value={b.id}>{b.nodeId} · {b.capability}</option>)}</select></label>
      <label className="block">{label('assignmentText')}<textarea className={field} maxLength={16000} value={text} onChange={e => setText(e.target.value)}/></label>
      <Button disabled={!text.trim() || !authorizedEmployee || (!!item.projectId && !selectedTarget) || !candidates.some(b => b.id === bindingId) || ['done', 'cancelled'].includes(item.status)} onClick={() => {if (window.confirm(label('confirm'))) void submit('/workspace/work-execution/assign', {workItemId: item.id, version: item.version, bindingId, employeeId, text, ...(selectedTarget ? {projectTargetId: selectedTarget} : {})});}}>{label('assignEmployee')}</Button>
      <h4>{label('requestReview')}</h4>
      {defaultReviewer && <Button type="button" variant="outline" disabled={!authorized.some(row => row.employeeId === defaultReviewer && row.available)} onClick={() => {setEmployeeId(defaultReviewer); setBindingId(''); setProjectTargetId('');}}>{pageLabel('defaultReviewer')}: {defaultReviewer}</Button>}
      <ReviewEvidenceFields links={links} notes={notes} source={source} onSource={setSource} description={description} onDescription={setDescription} evidence={evidence} onEvidence={setEvidence}/>
      <label className="block">{label('reviewInstructions')}<textarea className={field} maxLength={4000} value={instructions} onChange={e => setInstructions(e.target.value)}/></label>
      <Button disabled={!links.some(l => l.id === source && l.state === 'succeeded' && l.executionId) || !description.trim() || !candidates.some(b => b.id === bindingId) || ['done', 'cancelled'].includes(item.status) || !authorizedEmployee || (!!item.projectId && !selectedTarget)} onClick={() => {if (window.confirm(label('confirm'))) void submit('/workspace/work-note/request-review', {workItemId: item.id, version: item.version, sourceWorkExecutionId: source, evidenceNoteIds: evidence, evidenceDescription: description, reviewerEmployeeId: employeeId, reviewerBindingId: bindingId, instructions, ...(selectedTarget ? {reviewerProjectTargetId: selectedTarget} : {})});}}>{label('requestReview')}</Button>
      <h4>{label('reviewRecords')}</h4>
      {reviews.map(r => <article key={r.noteId} className="space-y-1 rounded border p-2 break-words"><p>{r.noteId} · v{r.workItemVersion} · {r.sourceWorkExecutionId} · {r.sourceExecutionId}</p><p>{r.reviewerExecution.state} · {r.conclusion ?? label('awaitingVerdict')}</p><p className="whitespace-pre-wrap">{r.evidenceDescription}</p><p className="whitespace-pre-wrap">{r.conclusionBody}</p>{r.reviewerExecution.executionId && <Button variant="outline" onClick={() => onExecution(r.reviewerExecution.executionId!)}>{label('openReviewSession')}</Button>}</article>)}
      <label className="block">{label('recordReview')}<select className={field} value={reviewId} onChange={e => {setReviewId(e.target.value); setConclusion('changes_requested');}}><option value="">{label('reviewRecords')}</option>{reviews.filter(r => !r.conclusion).map(r => <option key={r.noteId} value={r.noteId}>{r.noteId} · {r.reviewerExecution.state}</option>)}</select></label>
      <label className="block">{label('reviewConclusion')}<select className={field} value={conclusion} onChange={e => setConclusion(e.target.value)}><option value="changes_requested">{label('changesRequested')}</option><option value="passed" disabled={selectedReview?.reviewerExecution.state !== 'succeeded'}>{label('reviewPassed')}</option></select></label>
      <label className="block">{label('reviewReason')}<textarea className={field} maxLength={20000} value={verdict} onChange={e => setVerdict(e.target.value)}/></label>
      <Button disabled={!canRecord || !verdict.trim() || (conclusion === 'passed' && selectedReview?.reviewerExecution.state !== 'succeeded')} onClick={() => {if (window.confirm(label('verdictConfirm'))) void submit('/workspace/work-note/record-review', {reviewNoteId: reviewId, conclusion, body: verdict});}}>{label('recordReview')}</Button>
    </fieldset>
  </section>;
}
