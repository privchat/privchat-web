import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import Markdown from 'react-markdown';
import {ArrowLeft, ArrowUp, MoreHorizontal, Square} from 'lucide-react';
import type {PrivchatClient} from '@privchat/sdk';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {PlatformApiError} from '@/lib/platform-errors';
import type {Binding, Node, WorkExecution, WorkItem, WorkNote, WorkspaceApi} from './api';
import {usePageLabels} from './page-labels';
import {WorkItemPanel} from './work-item';
import {WorkflowPanel} from './workflow';
import type {PendingConsoleRequest} from './console-intent';
import {WorkspaceRoomObserver, roomFailure} from './room-observer';
import {taskIntent, taskResult, taskWorking, type TaskDecision, type TaskEntry} from './task-conversation';

type Props = {
  api: WorkspaceApi; initial: WorkItem; client?: PrivchatClient; viewerId?: string; executionId?: string;
  readOnly: boolean; onBack: () => void;
  renderSession: (id: string, task?: {readOnly: boolean}) => ReactNode;
  onLockChange: (locked: boolean) => void;
};

export function WorkDetails({api, initial, client, viewerId, executionId, readOnly, onBack, renderSession, onLockChange}: Props) {
  const l = usePageLabels();
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const [item, setItem] = useState(initial);
  const [snapshot, setSnapshot] = useState<{entries: TaskEntry[]; runs: WorkExecution[]; questions: TaskDecision[]}>();
  const [people, setPeople] = useState<Record<string, string>>({});
  const [ownedEmployees, setOwnedEmployees] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(executionId);
  const [mode, setMode] = useState<'details' | 'assign'>();
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [unknown, setUnknown] = useState<{request: PendingConsoleRequest; rerun: boolean}>();
  const [intent] = useState(() => taskIntent(api, initial.id, viewerId));
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const owner = !!viewerId && viewerId === item.createdBy;
  const canEdit = owner && !readOnly && !error;
  const terminal = item.status === 'done' || item.status === 'cancelled';
  const entries = snapshot?.entries ?? [];
  const developer = entries.filter(e => e.kind === 'turn' && e.role === 'developer').at(-1);
  const reviewer = entries.filter(e => e.kind === 'turn' && e.role === 'reviewer').at(-1);
  const working = entries.filter(e => e.kind === 'turn' && taskWorking.has(e.state ?? '')).at(-1);
  const pauseIndex = entries.map(e => e.kind).lastIndexOf('pause');
  const paused = pauseIndex >= 0 && !entries.slice(pauseIndex + 1).some(e => e.kind === 'requirement');
  const passed = entries.filter(e => e.kind === 'cycle').at(-1)?.state === 'recommendation_passed';
  const question = snapshot?.questions.find(q => q.workItemId === item.id && q.status === 'pending' && q.expiresAt > Date.now());
  const canTalk = canEdit && !!developer && !terminal;
  const name = (entry: TaskEntry) => (entry.employeeId && people[entry.employeeId]) ||
    (entry.role === 'reviewer' ? l('reviewEmployeeLabel') : l('devEmployeeLabel'));

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const version = ++generation.current;
    const query = `workItemId=${encodeURIComponent(initial.id)}`;
    try {
      const [current, entries, runs, questions] = await Promise.all([
        api.item(initial.id),
        api.get<TaskEntry[]>(`/workspace/work-instruction/timeline?${query}`),
        api.get<WorkExecution[]>(`/workspace/work-execution/list?${query}`),
        api.get<TaskDecision[]>(`/workspace/work-decision/list?${query}`),
      ]);
      if (current.id !== initial.id || current.workspaceId !== initial.workspaceId ||
          !Array.isArray(entries) || !Array.isArray(runs) || !Array.isArray(questions)) throw new Error('Invalid task snapshot');
      if (version !== generation.current) return;
      setItem(current); setSnapshot({entries, runs, questions}); setError(false); setDenied(false);
      return current;
    } catch (failure) {
      if (version !== generation.current) return;
      if (roomFailure(failure) === 'denied') {setDenied(true); setSnapshot(undefined); setPreviews({}); setMode(undefined);}
      setError(true);
      throw failure;
    }
  }, [api, initial.id, initial.workspaceId]);
  useEffect(() => {
    mounted.current = true;
    const read = () => void refresh().catch(() => {});
    let off: (() => void) | undefined;
    let room: WorkspaceRoomObserver | undefined;
    if (client && typeof client.observeEvents === 'function') {
      const session = new WorkspaceRoomObserver(initial.workspaceId, client, () => api.join(initial.workspaceId), async () => {
        const current = await refresh();
        return current ? [current] : [];
      }, state => {
        if (state === 'denied') {
          generation.current++;
          setDenied(true); setSnapshot(undefined); setPreviews({}); setMode(undefined); setError(true);
        } else if (state !== 'live') setError(true);
      });
      room = session;
      off = client.observeEvents(({event}) => {
        if (event.type === 'channel_publish_received') session.publish(event.channel_id, event.topic, event.payload_text);
        if (event.type === 'connection_state_changed') void session.refresh(true);
      });
      void session.refresh();
    }
    if (!room) read();
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (room) void room.refresh();
      else read();
    };
    const timer = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => {mounted.current = false; generation.current++; clearInterval(timer); document.removeEventListener('visibilitychange', tick); off?.(); void room?.stop();};
  }, [api, client, initial.workspaceId, refresh]);
  useEffect(() => {
    let active = true;
    void api.workspaceEmployees(initial.workspaceId).then(linked => {
      if (active) setPeople(prev => ({...prev, ...Object.fromEntries(linked.flatMap(e => e.name ? [[e.employeeId, e.name]] : []))}));
    }).catch(() => {});
    void api.employees().then(mine => {
      if (!active) return;
      setOwnedEmployees(mine.map(e => e.agentId));
      setPeople(prev => ({...prev, ...Object.fromEntries(mine.map(e => [e.agentId, e.name]))}));
    }).catch(() => {});
    return () => {active = false;};
  }, [api, initial.workspaceId]);
  const finished = snapshot?.runs;
  useEffect(() => {
    let active = true;
    // Results are optional; a missing archive does not hide the task timeline.
    const pending = (finished ?? []).filter(e => e.state === 'succeeded' && !previews[e.id]).slice(-12);
    void (async () => {
      for (const run of pending) {
        if (!active) break;
        const result = await taskResult(api, run).catch(() => undefined);
        if (active && result) setPreviews(current => ({...current, [run.id]: result}));
      }
    })();
    return () => {active = false;};
  }, [api, finished]); // A finished preview is immutable; retry missing ones on the next snapshot.

  async function act(path?: string, body?: Record<string, unknown>, confirmedRequestId?: string) {
    if (inFlight.current || !canEdit || terminal) return;
    inFlight.current = true; setBusy(true); setActionError(false);
    let request: PendingConsoleRequest | undefined;
    try {
      const submitted = path && body ? intent.run(api, path, body, 'requestId', undefined, confirmedRequestId) : intent.retry(api);
      request = intent.pendingRequest;
      await submitted;
      setUnknown(undefined);
      if (request?.path === '/workspace/work-instruction/send') setDraft('');
      await refresh().catch(() => {});
    } catch (failure) {
      if (request?.path === '/workspace/work-instruction/send' && !intent.hasPending &&
          failure instanceof PlatformApiError && failure.machineCode === 'AGENT_PREVIOUS_RESULT_UNKNOWN') {
        const detail = failure.fieldErrors.find(field => field.field === 'acknowledgeUnknown')?.params as {rerun?: unknown; workItemId?: unknown} | undefined;
        setUnknown({request, rerun: detail?.rerun === 1 && detail.workItemId === item.id});
      } else setActionError(true);
    }
    finally {inFlight.current = false; setBusy(false);}
  }

  async function accept() {
    if (inFlight.current || !canEdit || terminal || !passed || !window.confirm(label('acceptanceConfirm'))) return;
    inFlight.current = true; setBusy(true); setActionError(false);
    try {
      await api.put('/workspace/work-item/update-status', {id: item.id, version: item.version, status: 'done'});
      await refresh().catch(() => {});
    } catch {setActionError(true);}
    finally {inFlight.current = false; setBusy(false);}
  }

  const status = terminal ? label(`status_${item.status}`) : paused ? l(working ? 'taskPausing' : 'taskPaused')
    : working ? `${name(working)} · ${label(`execution_${working.state}`)}`
    : question ? l('taskDecision') : passed ? l('taskReviewPassed') : developer?.state === 'unknown' ? label('unknown') : undefined;

  if (denied) return <section className="space-y-3"><Button variant="ghost" onClick={onBack}>{l('back')}</Button><p role="alert">{l('accessDenied')}</p></section>;

  return <section className="mx-auto w-full min-w-0 max-w-[800px]" data-testid="task-conversation-page">
    <header className="flex items-center gap-3 border-b pb-4">
      <Button variant="ghost" size="icon" onClick={onBack} disabled={locked} aria-label={l('back')}><ArrowLeft className="h-4 w-4" /></Button>
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-xl font-semibold tracking-tight">{item.title}</h1>
        {(developer || reviewer) && <p className="mt-1 break-words text-xs text-muted-foreground">{[developer, reviewer].flatMap(turn => turn ? [name(turn)] : []).join(' · ')}</p>}
      </div>
      <Button data-testid="task-manage" variant="ghost" size="icon" aria-label={l('taskInfo')} onClick={() => setMode('details')}><MoreHorizontal className="h-5 w-5" /></Button>
    </header>
    {error && <div role="alert" className="my-4 flex flex-wrap items-center gap-2 text-sm text-destructive">{l('error')}<Button variant="outline" size="sm" onClick={() => void refresh().catch(() => {})}>{l('retry')}</Button></div>}
    {!snapshot && !error && <p role="status" className="py-6 text-sm text-muted-foreground">{l('loading')}</p>}
    {(readOnly || !owner) && <p className="mt-4 text-sm text-muted-foreground">{l('accessRead')}</p>}
    {snapshot && !developer && !terminal && <div className="my-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{l('taskNoDeveloper')}</p>
      {canEdit && <Button onClick={() => setMode('assign')}>{label('assignEmployee')}</Button>}
    </div>}
    {snapshot && <ol aria-label={l('taskConversation')} className="space-y-5 py-5">
      {!entries.some(e => e.kind === 'requirement') && item.description.trim() && <li className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-accent px-4 py-3 text-sm">{item.description}</li>}
      {entries.map(entry => {
        const key = `${entry.kind}:${entry.id}`;
        if (entry.kind === 'requirement') return entry.text?.trim() && <li key={key} className="ml-auto w-fit max-w-[85%]">
          <p className="whitespace-pre-wrap break-words rounded-xl bg-accent px-4 py-3 text-sm">{entry.text}</p>
          {entry.delivery && ['steered','interrupting','delivered','pending'].includes(entry.delivery) && <p className="mt-1 text-right text-xs text-muted-foreground">{l(`taskDelivery_${entry.delivery}` as 'taskDelivery_pending')}</p>}
        </li>;
        if (entry.kind === 'pause' || entry.kind === 'decision' || (entry.kind === 'cycle' && entry.state === 'stopped'))
          return <li key={key} className="text-center text-xs text-muted-foreground">{entry.kind === 'pause' ? l('taskPaused') : entry.text}</li>;
        if (entry.kind !== 'turn') return null;
        const run = snapshot.runs.find(e => e.id === entry.workExecutionId);
        const id = run?.executionId;
        const open = !!id && expanded === id;
        const result = run && previews[run.id];
        return <li key={key} id={`task-turn-${entry.id}`} className="space-y-2 rounded-xl border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{name(entry)} <span className="font-normal text-muted-foreground">· {entry.role === 'reviewer' ? l('reviewEmployeeLabel') : l('devEmployeeLabel')}</span></p>
            {entry.state && <span className="text-xs text-muted-foreground">{label(`execution_${entry.state}`)}</span>}
          </div>
          {result && <TaskMarkdown>{result}</TaskMarkdown>}
          {id && <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setExpanded(open ? undefined : id)}>{l('execProcess')}</Button>}
          {open && renderSession(id, {readOnly: !canEdit || terminal || !entry.employeeId || !ownedEmployees.includes(entry.employeeId)})}
        </li>;
      })}
    </ol>}
    {question && <aside className="mb-4 space-y-3 rounded-xl border bg-card p-4 text-sm">
      <h2 className="font-semibold">{l('taskDecision')}</h2>
      <p className="whitespace-pre-wrap break-words">{question.question}</p>
      {question.blockingReason && <TaskMarkdown>{question.blockingReason}</TaskMarkdown>}
      {canEdit && question.canAnswer && !terminal && <div className="flex flex-wrap gap-2">{question.options.map(option => <Button key={option.id} variant="outline" disabled={busy || intent.hasPending} title={option.description}
        onClick={() => void act('/workspace/work-decision/answer', {decisionId: question.id, optionId: option.id})}>{option.label}</Button>)}</div>}
    </aside>}
    {(canTalk || status || actionError || intent.hasPending) && <footer className="sticky bottom-0 space-y-2 border-t bg-background pb-2 pt-3">
      {status && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
        <span role="status">{status}</span>
        {working && ['waiting_permission', 'waiting_user'].includes(working.state ?? '') && (() => {
          const id = snapshot?.runs.find(run => run.id === working.workExecutionId)?.executionId;
          return id && <Button variant="ghost" size="sm" onClick={() => {
            setExpanded(id);
            document.getElementById(`task-turn-${working.id}`)?.scrollIntoView({block: 'nearest'});
          }}>{l('execProcess')}</Button>;
        })()}
        {canEdit && !terminal && passed && !working && <Button size="sm" disabled={busy || intent.hasPending} onClick={() => void accept()}>{l('taskConfirmDone')}</Button>}
        {canTalk && paused && !working && !passed && <Button variant="ghost" size="sm" onClick={() => input.current?.focus()}>{l('taskResume')}</Button>}
      </div>}
      {actionError && <p role="alert" className="text-sm text-destructive">{l('error')}</p>}
      {unknown && canTalk && !intent.hasPending && <div role="alert" className="space-y-2 rounded-lg border bg-card p-3 text-sm">
        <p>{l('acknowledgeUnknown')}</p>
        <div className="flex flex-wrap gap-2">{(['inspect', ...(unknown.rerun ? ['rerun'] : [])] as const).map(choice =>
          <Button key={choice} size="sm" variant="outline" disabled={busy} onClick={() => {
            const {requestId, ...body} = unknown.request.body;
            if (typeof requestId === 'string') void act(unknown.request.path, {...body, acknowledgeUnknown: choice}, requestId);
          }}>{l(choice === 'inspect' ? 'acknowledgeInspect' : 'acknowledgeRerun')}</Button>
        )}<Button size="sm" variant="ghost" disabled={busy} onClick={() => setUnknown(undefined)}>{l('cancel')}</Button></div>
      </div>}
      {intent.hasPending && <div className="flex flex-wrap items-center gap-2 text-sm"><span>{label('retryRecovery')}</span>
        <Button size="sm" disabled={!canEdit || busy || terminal} onClick={() => void act()}>{label('retrySame')}</Button></div>}
      {canTalk && <form className="flex items-end gap-2 rounded-xl border bg-card p-2" onSubmit={event => {
        event.preventDefault();
        if (draft.trim() && !intent.hasPending && !unknown) void act('/workspace/work-instruction/send', {workItemId: item.id, text: draft.trim()});
      }}>
        <textarea ref={input} aria-label={l('composerPlaceholder')} placeholder={l('composerPlaceholder')} maxLength={16000} rows={2}
          className="min-w-0 flex-1 resize-y rounded-md bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={draft} disabled={busy || intent.hasPending || !!unknown} onChange={e => setDraft(e.target.value)}/>
        {working && !paused && !draft.trim() ? <Button type="button" size="icon" variant="outline" aria-label={l('pauseBtn')} disabled={busy || intent.hasPending || !!unknown}
          onClick={() => void act('/workspace/work-instruction/pause', {workItemId: item.id})}><Square className="h-4 w-4" /></Button>
          : <Button size="icon" type="submit" aria-label={l('sendBtn')} disabled={!draft.trim() || busy || intent.hasPending || !!unknown}><ArrowUp className="h-4 w-4" /></Button>}
      </form>}
    </footer>}
    <Dialog open={mode !== undefined} onOpenChange={open => {if (!open && !locked) setMode(undefined);}}>
      {mode && <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{mode === 'assign' ? label('assignEmployee') : l('taskInfo')}</DialogTitle></DialogHeader>
        <TaskManagement api={api} item={item} mode={mode} readOnly={!canEdit} refresh={async () => {await refresh();}}
          onLockChange={value => {setLocked(value); onLockChange(value);}}
          onExecution={id => {setExpanded(id); setMode(undefined); void refresh().catch(() => {});}} />
      </DialogContent>}
    </Dialog>
  </section>;
}

function TaskMarkdown({children}: {children: string}) {
  return <div className="space-y-2 break-words leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5">
    <Markdown skipHtml disallowedElements={['img']} components={{
      a: ({href, children}) => href && /^https?:\/\//i.test(href)
        ? <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>
        : <span>{children}</span>,
    }}>{children}</Markdown>
  </div>;
}

function TaskManagement({api, item, mode, readOnly, refresh, onLockChange, onExecution}: {
  api: WorkspaceApi; item: WorkItem; mode: 'details' | 'assign'; readOnly: boolean; refresh: () => Promise<void>;
  onLockChange: (locked: boolean) => void; onExecution: (id: string) => void;
}) {
  const l = usePageLabels();
  const [data, setData] = useState<{notes: WorkNote[]; nodes: Node[]; bindings: Binding[]}>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    const query = `workItemId=${encodeURIComponent(item.id)}`;
    void Promise.all([api.get<WorkNote[]>(`/workspace/work-note/list?${query}`), readOnly ? [] : api.nodes(), readOnly ? [] : api.bindings(item.workspaceId)])
      .then(([notes, nodes, bindings]) => {if (live) setData({notes, nodes, bindings});})
      .catch(() => {if (live) setError(true);});
    return () => {live = false;};
  }, [api, item.id, item.workspaceId, readOnly]);
  if (error) return <p role="alert">{l('error')}</p>;
  if (!data) return <p role="status">{l('loading')}</p>;
  return <div className="space-y-4">
    {mode === 'details' && <WorkItemPanel api={api} item={item} notes={data.notes} readOnly={readOnly} refresh={refresh}/>}
    {!readOnly && !['done', 'cancelled'].includes(item.status) && <WorkflowPanel api={api} item={item} {...data} readOnly={readOnly} assignmentOnly={mode === 'assign'} onLockChange={onLockChange} onExecution={onExecution}/>}
  </div>;
}
