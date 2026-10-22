import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type Binding, type Employee, type Node, type WorkExecution, type WorkItem, type WorkNote, type WorkReview } from './api';
import { matchingEmployeeBindings, ReviewEvidenceFields } from './workflow-targets';
import { ConsoleIntent } from './console-intent';
import { roomFailure } from './room-observer';

const field = 'block w-full min-w-0 rounded border bg-background px-3 py-2 text-sm';
export function WorkflowPanel({api, item, nodes, bindings, notes, readOnly, onLockChange, onExecution}: {api: WorkspaceApi; item: WorkItem; nodes: Node[]; bindings: Binding[]; notes: WorkNote[]; readOnly: boolean; onLockChange: (locked: boolean) => void; onExecution: (id: string) => void}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [links, setLinks] = useState<WorkExecution[]>([]);
  const [reviews, setReviews] = useState<WorkReview[]>([]);
  const [employeeId, setEmployeeId] = useState('');
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
  const intent = useRef(new ConsoleIntent());
  const operation = useRef<{path: string; body: Record<string, unknown>} | undefined>(undefined);
  const live = useRef(false);
  const running = useRef(false);
  const employee = employees.find(e => e.agentId === employeeId);
  const candidates = matchingEmployeeBindings(employee, bindings, nodes);
  const locked = busy || intent.current.hasPending;
  const disabled = locked || readOnly || !ready;
  const selectedReview = reviews.find(r => r.noteId === reviewId);
  const canRecord = !!selectedReview && !selectedReview.conclusion && ['succeeded', 'failed', 'cancelled'].includes(selectedReview.reviewerExecution.state ?? '');
  async function refresh() {
    const [e, l, r] = await Promise.all([api.employees(), api.get<WorkExecution[]>(`/workspace/work-execution/list?workItemId=${encodeURIComponent(item.id)}`), api.get<WorkReview[]>(`/workspace/work-note/review-list?workItemId=${encodeURIComponent(item.id)}`)]);
    if (live.current) {setEmployees(e); setLinks(l); setReviews(r); setReady(true);}
  }
  useEffect(() => {
    live.current = true; let polling = false;
    const poll = async () => {if (polling) return; polling = true; try {await refresh();} catch (e) {if (live.current) {setError(roomFailure(e) === 'denied' ? 'denied' : 'unsupported'); setReady(false); setEmployees([]); setLinks([]); setReviews([]);}} finally {polling = false;}};
    void poll(); const timer = setInterval(() => void poll(), 10000);
    return () => {live.current = false; clearInterval(timer); onLockChange(false);};
  }, [api, item.id]);
  async function submit(path?: string, body?: Record<string, unknown>) {
    if (running.current) return;
    if (path && body && !intent.current.hasPending) operation.current = {path, body};
    const op = operation.current;
    if (!op) return;
    running.current = true; setBusy(true); setError(''); setSaved(false); onLockChange(true);
    try {
      const result = await intent.current.run<WorkExecution | WorkReview>(api, op.path, op.body, 'requestId');
      if (!live.current) return;
      setSaved(true);
      const execution = 'reviewerExecution' in result ? result.reviewerExecution.executionId : result.executionId;
      if (execution) onExecution(execution);
      await refresh();
    } catch (e) {if (live.current) setError(roomFailure(e) === 'denied' ? 'denied' : intent.current.hasPending ? 'unknown' : 'itemError');}
    finally {running.current = false; onLockChange(intent.current.hasPending); if (live.current) setBusy(false);}
  }
  return <section data-testid="workflow-panel" className="min-w-0 space-y-3 rounded border p-3">
    <h3 className="font-semibold">{label('employeeWorkflow')}</h3><p className="text-sm">{label('workflowHint')}</p>
    {error && <p role="alert">{label(error)}</p>}{saved && <p role="status">{label('workflowSaved')}</p>}
    {intent.current.hasPending && <><p>{label('retryRecovery')}</p><Button disabled={busy} onClick={() => void submit()}>{label('retrySame')}</Button></>}
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <label className="block">{label('employees')}<select className={field} value={employeeId} onChange={e => {setEmployeeId(e.target.value); setBindingId('');}}><option value="">{label('employees')}</option>{employees.map(e => <option key={e.agentId} value={e.agentId}>{e.name} · {e.title}</option>)}</select></label>
      <label className="block">{label('binding')}<select className={field} value={bindingId} onChange={e => setBindingId(e.target.value)}><option value="">{label('binding')}</option>{candidates.map(b => <option key={b.id} value={b.id}>{b.nodeId} · {b.capability}</option>)}</select></label>
      <label className="block">{label('assignmentText')}<textarea className={field} maxLength={16000} value={text} onChange={e => setText(e.target.value)}/></label>
      <Button disabled={!text.trim() || !candidates.some(b => b.id === bindingId) || ['done', 'cancelled'].includes(item.status)} onClick={() => {if (window.confirm(label('confirm'))) void submit('/workspace/work-execution/assign', {workItemId: item.id, version: item.version, bindingId, employeeId, text});}}>{label('assignEmployee')}</Button>
      <h4>{label('requestReview')}</h4>
      <ReviewEvidenceFields links={links} notes={notes} source={source} onSource={setSource} description={description} onDescription={setDescription} evidence={evidence} onEvidence={setEvidence}/>
      <label className="block">{label('reviewInstructions')}<textarea className={field} maxLength={4000} value={instructions} onChange={e => setInstructions(e.target.value)}/></label>
      <Button disabled={!links.some(l => l.id === source && l.state === 'succeeded' && l.executionId) || !description.trim() || !candidates.some(b => b.id === bindingId) || ['done', 'cancelled'].includes(item.status)} onClick={() => {if (window.confirm(label('confirm'))) void submit('/workspace/work-note/request-review', {workItemId: item.id, version: item.version, sourceWorkExecutionId: source, evidenceNoteIds: evidence, evidenceDescription: description, reviewerEmployeeId: employeeId, reviewerBindingId: bindingId, instructions});}}>{label('requestReview')}</Button>
      <h4>{label('reviewRecords')}</h4>
      {reviews.map(r => <article key={r.noteId} className="space-y-1 rounded border p-2 break-words"><p>{r.noteId} · v{r.workItemVersion} · {r.sourceWorkExecutionId} · {r.sourceExecutionId}</p><p>{r.reviewerExecution.state} · {r.conclusion ?? label('awaitingVerdict')}</p><p className="whitespace-pre-wrap">{r.evidenceDescription}</p><p className="whitespace-pre-wrap">{r.conclusionBody}</p>{r.reviewerExecution.executionId && <Button variant="outline" onClick={() => onExecution(r.reviewerExecution.executionId!)}>{label('openReviewSession')}</Button>}</article>)}
      <label className="block">{label('recordReview')}<select className={field} value={reviewId} onChange={e => {setReviewId(e.target.value); setConclusion('changes_requested');}}><option value="">{label('reviewRecords')}</option>{reviews.filter(r => !r.conclusion).map(r => <option key={r.noteId} value={r.noteId}>{r.noteId} · {r.reviewerExecution.state}</option>)}</select></label>
      <label className="block">{label('reviewConclusion')}<select className={field} value={conclusion} onChange={e => setConclusion(e.target.value)}><option value="changes_requested">{label('changesRequested')}</option><option value="passed" disabled={selectedReview?.reviewerExecution.state !== 'succeeded'}>{label('reviewPassed')}</option></select></label>
      <label className="block">{label('reviewReason')}<textarea className={field} maxLength={20000} value={verdict} onChange={e => setVerdict(e.target.value)}/></label>
      <Button disabled={!canRecord || !verdict.trim() || (conclusion === 'passed' && selectedReview?.reviewerExecution.state !== 'succeeded')} onClick={() => {if (window.confirm(label('verdictConfirm'))) void submit('/workspace/work-note/record-review', {reviewNoteId: reviewId, conclusion, body: verdict});}}>{label('recordReview')}</Button>
    </fieldset>
  </section>;
}
