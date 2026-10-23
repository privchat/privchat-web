import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type Binding, type Employee, type Execution, type Node, type WorkExecution, type WorkItem, type WorkNote, type Workspace } from './api';
import { matchingEmployeeBindings, ReviewEvidenceFields } from './workflow-targets';
import { persistentAssistantIntent } from './console-intent-storage';
import { getActiveAccountKey, subscribeActiveAccount } from '../../lib/active-account';
import { PlatformHttpError } from '@/lib/platform-errors';
import { roomFailure } from './room-observer';
import { assistantErrorLabel, assistantReplyText, conversationPage, isAssistantTask, type AssistantActionKind, type AssistantContext, type AssistantIdentity, type AssistantMessage, type AssistantReference, type ConversationSendResult } from './assistant-api';

const field = 'block w-full min-w-0 rounded border bg-background px-3 py-2 text-sm';

export function AssistantPage({api, onBack, onConsole, onLockChange}: {api: WorkspaceApi; onBack: () => void; onConsole: (reference?: AssistantReference) => void; onLockChange: (locked: boolean) => void}) {
  const {t, i18n} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const [identity, setIdentity] = useState<AssistantIdentity>();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [executionId, setExecutionId] = useState('');
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [spaceId, setSpaceId] = useState('');
  const [items, setItems] = useState<WorkItem[]>([]);
  const [itemId, setItemId] = useState('');
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [bindingId, setBindingId] = useState('');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<WorkExecution[]>([]);
  const [notes, setNotes] = useState<WorkNote[]>([]);
  const [source, setSource] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [targetError, setTargetError] = useState(false);
  const [kind, setKind] = useState<AssistantActionKind>('help');
  const [advanced, setAdvanced] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [receipt, setReceipt] = useState('');
  const accountKey = useSyncExternalStore(subscribeActiveAccount, getActiveAccountKey);
  const intent = useMemo(() => persistentAssistantIntent(accountKey, api.base), [accountKey, api]);
  const cursor = useRef('0');
  const live = useRef(false);
  const polling = useRef(false);
  const inFlight = useRef(false);
  const employee = employees.find(e => e.agentId === employeeId);
  const item = items.find(i => i.id === itemId);
  const space = spaces.find(s => s.id === spaceId);
  const candidates = matchingEmployeeBindings(employee, bindings, nodes);
  const workspaceAction = kind === 'assign' || kind === 'review';
  const valid = !advanced || (!targetError && (kind === 'help' || workspaceAction
    ? kind === 'help' || (!!item && space?.archived === 0 && !['done', 'cancelled'].includes(item.status) && candidates.some(b => b.id === bindingId) && (kind !== 'review' || (!!description.trim() && links.some(l => l.id === source && l.state === 'succeeded' && l.executionId))))
    : spaceId ? !!source && links.some(l => l.id === source && l.executionId) : !!employeeId && (kind !== 'cancel' || !!executionId)));
  const locked = busy || intent.hasPending;
  useEffect(() => { onLockChange(locked); }, [locked, onLockChange]);
  const merge = (rows: AssistantMessage[]) => setMessages(old => [...new Map([...old, ...rows].map(m => [m.id, m])).values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
  async function refresh() {
    if (polling.current) return;
    polling.current = true;
    try {
      const page = await conversationPage(api, cursor.current);
      if (!live.current) return;
      merge(page.items); cursor.current = page.nextAfterId; setHasMore(page.hasMore); setReady(true); setError('');
    } catch (e) {
      if (!live.current) return;
      const denied = roomFailure(e) === 'denied';
      setError(denied ? 'denied' : e instanceof PlatformHttpError && [404, 405, 501].includes(e.status) ? 'unsupported' : 'error');
      if (denied) {setMessages([]); setEmployees([]); setExecutions([]); setReady(false);}
    } finally {polling.current = false;}
  }
  useEffect(() => {
    live.current = true;
    void api.get<AssistantIdentity>('/assistant/personal').then(async result => {
      if (!live.current) return;
      setIdentity(result);
      if (result.claimed) await refresh();
    }).catch(() => {if (live.current) setError('error');}).finally(() => {if (live.current) setLoading(false);});
    void api.employees().then(rows => {if (live.current) setEmployees(rows);}).catch(() => {});
    void api.list().then(rows => {if (live.current) setSpaces(rows);}).catch(() => {});
    void api.nodes().then(rows => {if (live.current) setNodes(rows);}).catch(() => {});
    const timer = setInterval(() => {if (document.visibilityState === 'visible' && live.current) void api.get<AssistantIdentity>('/assistant/personal').then(result => {if (live.current && result.claimed) void refresh();}).catch(() => {});}, 5000);
    return () => {live.current = false; clearInterval(timer); onLockChange(false);};
  }, [api]);
  useEffect(() => {
    let active = true;
    setExecutions([]); setExecutionId('');
    if (employee?.nodeId) void api.executions(employee.nodeId).then(rows => {if (active) setExecutions(rows.filter(e => e.agentId === employee.agentId));}).catch(() => {});
    return () => {active = false;};
  }, [api, employee?.agentId, employee?.nodeId]);
  useEffect(() => {
    let active = true;
    setItems([]); setBindings([]); setItemId(''); setBindingId(''); setTargetError(false);
    if (spaceId) void Promise.all([api.items(spaceId), api.bindings(spaceId)]).then(([rows, b]) => {if (active) {setItems(rows); setBindings(b);}}).catch(() => {if (active) setTargetError(true);});
    return () => {active = false;};
  }, [api, spaceId]);
  useEffect(() => {
    let active = true, running = false;
    setLinks([]); setNotes([]); setSource(''); setEvidence([]); setDescription(''); setTargetError(false);
    if (!itemId) return () => {active = false;};
    const refreshTargets = async () => {
      if (running) return;
      running = true;
      try {
        const [l, n] = await Promise.all([api.get<WorkExecution[]>(`/workspace/work-execution/list?workItemId=${encodeURIComponent(itemId)}`), api.get<WorkNote[]>(`/workspace/work-note/list?workItemId=${encodeURIComponent(itemId)}`)]);
        if (active) {setLinks(l); setNotes(n); setTargetError(false);}
      } catch (e) {if (active) {setTargetError(true); if (roomFailure(e) === 'denied') {setLinks([]); setNotes([]);}}}
      finally {running = false;}
    };
    void refreshTargets();
    const timer = setInterval(() => {if (document.visibilityState === 'visible') void refreshTargets();}, 5000);
    return () => {active = false; clearInterval(timer);};
  }, [api, itemId]);
  async function send() {
    if (inFlight.current) return;
    if (!intent.hasPending && (!valid || !text.trim())) return;
    if (advanced && kind === 'cancel' && !intent.hasPending && !window.confirm(label('confirm'))) return;
    inFlight.current = true; setBusy(true); setError(''); onLockChange(true);
    try {
      const retain = (result: ConversationSendResult) => {
        if (!result || result.requestId !== intent.pendingRequest?.body.requestId ||
            !['pending', 'settled'].includes(result.status) || !Array.isArray(result.messages)) {
          throw new Error('Invalid assistant receipt');
        }
        return result.status === 'pending';
      };
      let result: ConversationSendResult;
      if (intent.hasPending) {
        // Recovery must not depend on a freshly loaded form or target snapshot.
        result = await intent.retry<ConversationSendResult>(api, retain);
      } else {
        const context: AssistantContext = !advanced || kind === 'help' ? {} : workspaceAction ? {
          workspaceId: spaceId, workItemId: itemId, workItemVersion: item!.version, agentId: employeeId, bindingId,
          ...(kind === 'review' ? {workExecutionId: source, evidenceNoteIds: evidence, evidenceDescription: description} : {}),
        } : spaceId ? {workspaceId: spaceId, workItemId: itemId, workExecutionId: source}
          : executionId && kind !== 'send_employee' ? {agentId: employeeId, executionId} : {agentId: employeeId};
        result = await intent.run<ConversationSendResult>(api, '/assistant/conversation/send', {text, ...(advanced ? {action: {kind, context}} : {})}, 'requestId', retain);
      }
      if (!live.current) return;
      merge(result.messages); setReceipt(result.status);
      if (!intent.hasPending) setText('');
    } catch (e) {if (live.current) {
      const denied = roomFailure(e) === 'denied';
      setError(denied ? 'denied' : intent.hasPending ? 'unknown' : 'error');
      if (denied) {setMessages([]); setReady(false);}
    }}
    finally {inFlight.current = false; onLockChange(intent.hasPending); if (live.current) setBusy(false);}
  }
  return <main data-testid="assistant-page" className="mx-auto w-full max-w-4xl min-w-0 space-y-4 overflow-y-auto p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-semibold">{label('assistantTitle')}</h1><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={locked} onClick={() => onConsole()}>{label('openConsole')}</Button><Button variant="outline" disabled={locked} onClick={onBack}>{label('back')}</Button></div></div>
    <p className="text-sm text-muted-foreground">{label('assistantHint')}</p>
    {loading && <p role="status">{label('loading')}</p>}
    {error && <p role="alert">{label(error)}</p>}
    {identity && !identity.claimed && <section><p>{label('assistantUnclaimed')}</p>{identity.available && <Button disabled={busy} onClick={() => {
      if (!window.confirm(label('confirm'))) return;
      setBusy(true);
      void api.post<NonNullable<AssistantIdentity['assistant']>>('/assistant/personal/claim', {confirmed: true}).then(async assistant => {if (live.current) {setIdentity({...identity, claimed: true, assistant}); await refresh();}}).catch(() => {if (live.current) setError('error');}).finally(() => {if (live.current) setBusy(false);});
    }}>{label('claimAssistant')}</Button>}</section>}
    {identity?.claimed && <>
      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>{label(hasMore ? 'more' : 'refresh')}</Button>
      <section aria-label={label('assistantMessages')} aria-live="polite" className="space-y-3">
        {!loading && !messages.length && <p>{label('empty')}</p>}
        {messages.map(m => <article data-testid="assistant-message" key={m.id} className="min-w-0 space-y-1 rounded border p-3">
          <p className="text-xs text-muted-foreground">{label(m.role === 'user' ? 'messageUser' : 'assistantTitle')} · {new Date(m.createdAt).toLocaleString(i18n.resolvedLanguage)}</p>
          {m.role !== 'user' && isAssistantTask(m.result) && typeof m.result?.detail === 'string' && m.result.detail.trim() && <p className="text-xs text-muted-foreground">{label('assistantEmployeeOutput')}</p>}
          {(m.role === 'user' ? [m.text] : assistantReplyText(m)).map((body, index) => <p key={index} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{body}</p>)}
          {m.role !== 'user' && m.result && <>
            {!['clarification', 'help'].includes(m.result.replyKind ?? '') && <p data-testid="assistant-task-status">{label(['accepted', 'completed', 'rejected', 'unknown'].includes(m.result.outcome) ? `outcome_${m.result.outcome}` : 'unknown')}{m.result.state && ` · ${label(['accepted', 'dispatched', 'waiting_user', 'cancelling', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown', 'waiting_permission', 'pending'].includes(m.result.state) ? `execution_${m.result.state}` : 'unknown')}`}</p>}
            {m.result.errorCode && <><p>{label(assistantErrorLabel(m.result.errorCode, m.result.outcome))}</p><code className="break-all">{m.result.errorCode}</code></>}
          </>}
          {m.result?.reference && <><p className="break-all text-xs">{Object.entries(m.result.reference).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(' · ')}</p><Button variant="outline" disabled={locked} onClick={() => onConsole(m.result!.reference)}>{label('openTarget')}</Button></>}
        </article>)}
      </section>
      {receipt && <p role="status">{label('assistantReceipt')}: {label(receipt === 'settled' ? 'receiptSettled' : 'pending')}</p>}
      <form className="space-y-3" onSubmit={e => {e.preventDefault(); void send();}}>
        <fieldset disabled={locked || !ready} className="min-w-0 space-y-3">
          <label className="block">{label('assistantGoal')}<textarea className={field} value={String(intent.pendingRequest?.body.text ?? text)} onChange={e => setText(e.target.value)}/></label>
          <Button type="button" variant="outline" aria-expanded={advanced} aria-controls="assistant-advanced" onClick={() => setAdvanced(value => !value)}>{label('assistantAdvanced')}</Button>
          {advanced && <div id="assistant-advanced" className="space-y-3">
          <label className="block">{label('assistantAction')}<select className={field} value={kind} onChange={e => {setKind(e.target.value as AssistantActionKind); setExecutionId(''); setSource(''); if (e.target.value === 'send_employee') setSpaceId('');}}>{(['help', 'status', 'send_employee', 'assign', 'review', 'cancel'] as const).map(k => <option key={k} value={k}>{label(`action_${k}`)}</option>)}</select></label>
          {kind !== 'help' && kind !== 'send_employee' && <>
            <label className="block">{label('spaces')}<select className={field} value={spaceId} onChange={e => setSpaceId(e.target.value)}><option value="">{label('privateTarget')}</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            {spaceId && <label className="block">{label('work')}<select className={field} value={itemId} onChange={e => setItemId(e.target.value)}><option value="">{label('work')}</option>{items.map(i => <option key={i.id} value={i.id}>{i.title} · v{i.version} · {i.status}</option>)}</select></label>}
          </>}
          {targetError && <p role="alert">{label('error')}</p>}
          {kind !== 'help' && <>
            {(!spaceId || workspaceAction) && <label className="block">{label('employees')}<select className={field} value={employeeId} onChange={e => {setEmployeeId(e.target.value); setBindingId('');}}><option value="">{label('employees')}</option>{employees.map(e => <option key={e.agentId} value={e.agentId}>{e.name} · {e.title}</option>)}</select></label>}
            {workspaceAction && <label className="block">{label('binding')}<select className={field} value={bindingId} onChange={e => setBindingId(e.target.value)}><option value="">{label('binding')}</option>{candidates.map(b => <option key={b.id} value={b.id}>{b.nodeId} · {b.capability}</option>)}</select></label>}
            {kind === 'review' && <ReviewEvidenceFields links={links} notes={notes} source={source} onSource={setSource} description={description} onDescription={setDescription} evidence={evidence} onEvidence={setEvidence} maxDescription={2000}/>}
            {!workspaceAction && kind !== 'send_employee' && (spaceId ? <label className="block">{label('executions')}<select className={field} value={source} onChange={e => setSource(e.target.value)}><option value="">{label('executions')}</option>{links.filter(l => l.executionId).map(l => <option key={l.id} value={l.id}>{l.id} · {l.executionId} · {l.state}</option>)}</select></label> : <label className="block">{label('executions')}<select className={field} value={executionId} onChange={e => setExecutionId(e.target.value)}><option value="">{label('managedSession')}</option>{executions.map(e => <option key={e.executionId} value={e.executionId}>{e.executionId} · {e.state}</option>)}</select></label>)}
          </>}
          </div>}
        </fieldset>
        {intent.hasPending ? <><p role="status">{label('retryRecovery')}</p><Button disabled={busy} type="submit">{label('retrySame')}</Button></> : <Button disabled={busy || !ready || !text.trim() || !valid}>{label('sendEmployee')}</Button>}
      </form>
    </>}
  </main>;
}
