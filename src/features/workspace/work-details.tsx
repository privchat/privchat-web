import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Check, ChevronDown, ChevronRight, Circle, Clock, RotateCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {Binding, Employee, Node, Project, WorkExecution, WorkNote, WorkReview, WorkspaceActivity, WorkspaceApi} from './api';
import {usePageLabels} from './page-labels';
import {StatusPill, WsPageHeader} from './shell';
import {WorkItemPanel} from './work-item';
import {WorkflowPanel} from './workflow';
import {taskStageLabel, taskStatusCategory} from './task-stage';
import {ConsoleIntent} from './console-intent';

const CATEGORY_ICON = {pending: Circle, running: RotateCw, review: Clock, done: Check} as const;

/** One avatar-bubble row of the task conversation; the left rail connects successive rounds. */
function ThreadRow({name, action, last, children}: {name: string; action: string; last: boolean; children: ReactNode}) {
  const initial = (name.trim() || '?').charAt(0).toUpperCase();
  return <li className="relative flex gap-3 pb-5 last:pb-0">
    <div className="relative flex w-7 shrink-0 justify-center">
      {!last && <span aria-hidden="true" className="absolute bottom-0 left-1/2 top-7 w-px -translate-x-1/2 bg-border" />}
      <span className="flex h-7 w-7 items-center justify-center rounded-full border bg-accent text-xs font-semibold">{initial}</span>
    </div>
    <div className="min-w-0 flex-1 space-y-1.5">
      <p className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold">{name}</span><span className="text-muted-foreground">{action}</span></p>
      <div className="rounded-[9px] border bg-card px-3.5 py-3 text-sm">{children}</div>
    </div>
  </li>;
}

function InfoRow({label, value}: {label: string; value: string}) {
  return <div className="flex justify-between gap-2.5"><span className="shrink-0 text-muted-foreground">{label}</span><span className="break-words text-right">{value}</span></div>;
}

export function WorkDetails({api, row, readOnly, onBack, renderSession, onLockChange}: {api: WorkspaceApi; row: WorkspaceActivity; readOnly: boolean; onBack: () => void; renderSession: (id: string) => ReactNode; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const [item, setItem] = useState(row.item);
  const [notes, setNotes] = useState<WorkNote[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [links, setLinks] = useState<WorkExecution[]>([]);
  const [reviews, setReviews] = useState<WorkReview[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [project, setProject] = useState<Project>();
  const [expanded, setExpanded] = useState<string | undefined>(row.latestExecution?.executionId ?? undefined);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState(false);
  const intent = useRef(new ConsoleIntent());
  const live = useRef(true);

  const empName = (id?: string | null) => id ? employees.find(e => e.agentId === id)?.name ?? id : undefined;
  const developerId = row.developerEmployeeId ?? links.at(-1)?.employeeId;
  const reviewerId = row.reviewerEmployeeId ?? reviews.at(-1)?.reviewerEmployeeId;
  const latest = links.at(-1)?.executionId ?? row.latestExecution?.executionId ?? '';
  const terminal = ['done', 'cancelled'].includes(item.status);
  const composerDisabled = readOnly || !latest || terminal;
  const category = taskStatusCategory({stage: row.stage, item});
  const Icon = CATEGORY_ICON[category];
  const pill = row.stage ? taskStageLabel({stage: row.stage, item}, t) : label(`status_${item.status}`);

  async function refresh() {
    const [current, n, b, w, emp] = await Promise.all([
      api.item(item.id), api.nodes(), api.bindings(item.workspaceId),
      api.get<WorkNote[]>(`/workspace/work-note/list?workItemId=${encodeURIComponent(item.id)}`),
      api.employees().catch(() => [] as Employee[]),
    ]);
    if (!live.current) return;
    if (!current || current.id !== item.id || current.workspaceId !== item.workspaceId) throw new Error('Work item unavailable');
    setItem(current); setNotes(w); setNodes(n); setBindings(b); setEmployees(emp);
  }
  async function loadConversation() {
    const [ex, rv] = await Promise.all([
      api.get<WorkExecution[]>(`/workspace/work-execution/list?workItemId=${encodeURIComponent(item.id)}`).catch(() => [] as WorkExecution[]),
      api.get<WorkReview[]>(`/workspace/work-note/review-list?workItemId=${encodeURIComponent(item.id)}`).catch(() => [] as WorkReview[]),
    ]);
    if (live.current) {setLinks(ex); setReviews(rv);}
  }
  useEffect(() => {live.current = true; void refresh().catch(() => {if (live.current) setError(true);}); return () => {live.current = false;};}, [api, item.id]);
  useEffect(() => {
    let active = true; setProject(undefined);
    if (item.projectId) void api.project(item.projectId).then(p => {if (active) setProject(p);}).catch(() => {});
    return () => {active = false;};
  }, [api, item.projectId]);
  useEffect(() => {void loadConversation(); const timer = setInterval(() => void loadConversation(), 10000); return () => clearInterval(timer);}, [api, item.id]);

  function focusExecution(id: string) {setExpanded(id); void refresh().catch(() => {}); void loadConversation();}
  async function send() {
    if (sending || composerDisabled || (!draft.trim() && !intent.current.hasPending)) return;
    setSending(true); setComposerError(false);
    try {await intent.current.run(api, '/agent/sessions/send', {continueFromExecutionId: latest, text: draft}); if (live.current) {setDraft(''); await loadConversation();}}
    catch {if (live.current) setComposerError(true);}
    finally {if (live.current) setSending(false);}
  }
  async function pause() {
    if (sending || composerDisabled || !window.confirm(label('confirm'))) return;
    setSending(true); setComposerError(false);
    try {await api.post('/agent/executions/cancel', {executionId: latest}); if (live.current) await loadConversation();}
    catch {if (live.current) setComposerError(true);}
    finally {if (live.current) setSending(false);}
  }

  return <section className="w-full min-w-0">
    <WsPageHeader title={item.title} subtitle={<><span className="font-mono">{item.id.slice(0, 8)}</span>{project ? ` · ${project.name}` : ''}</>} actions={<>
      <Button variant="ghost" size="sm" disabled={locked} onClick={onBack}>{l('back')}</Button>
      <StatusPill icon={Icon}>{pill}</StatusPill>
    </>} />
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{l('error')}</p>}
    <div className="grid gap-[22px] lg:grid-cols-[minmax(0,1fr)_245px]">
      <div className="min-w-0">
        <h3 className="mb-4 text-[17px] font-semibold">{l('taskConversation')}</h3>
        <ol className="m-0 list-none p-0">
          <ThreadRow name={item.createdBy ?? '—'} action={l('creatorBubble')} last={links.length === 0}>
            <p className="whitespace-pre-wrap break-words">{item.description || '—'}</p>
          </ThreadRow>
          {links.map((e, index) => {
            const open = !!e.executionId && expanded === e.executionId;
            return <ThreadRow key={e.id} name={empName(e.employeeId) ?? l('unassigned')} action={`${l('devRound')} ${index + 1}`} last={index === links.length - 1}>
              <div className="space-y-2">
                <p className="text-muted-foreground">{e.state ? label(`execution_${e.state}`) : label('notExecuted')}</p>
                {e.executionId && <button type="button" aria-expanded={open} className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setExpanded(open ? undefined : e.executionId!)}>
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{l('execProcess')}
                </button>}
                {open && <div className="min-w-0">{renderSession(e.executionId!)}</div>}
              </div>
            </ThreadRow>;
          })}
        </ol>
        <div className="mt-5 space-y-2.5">
          <textarea aria-label={l('composerPlaceholder')} placeholder={l('composerPlaceholder')} maxLength={16000} rows={3} className="block w-full min-w-0 rounded-[9px] border bg-background px-3.5 py-3 text-sm" value={draft} disabled={composerDisabled || sending || intent.current.hasPending} onChange={e => setDraft(e.target.value)}/>
          {composerError && <p role="alert" className="text-sm text-destructive">{l('error')}</p>}
          {intent.current.hasPending && <p role="status" className="text-sm text-muted-foreground">{label('retryRecovery')}</p>}
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" disabled={composerDisabled || sending} onClick={() => void pause()}>{l('pauseBtn')}</Button>
            <Button disabled={composerDisabled || sending || !draft.trim()} onClick={() => void send()}>{l('sendBtn')}</Button>
          </div>
        </div>
        <details data-testid="task-manage" className="mt-6 rounded-[9px] border px-4 py-3">
          <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground hover:text-foreground">{l('taskManage')}</summary>
          <div className="mt-4 space-y-[22px]">
            <WorkItemPanel api={api} item={item} notes={notes} readOnly={readOnly || error} refresh={refresh}/>
            <WorkflowPanel api={api} item={item} nodes={nodes} bindings={bindings} notes={notes} readOnly={readOnly || error} onLockChange={value => {setLocked(value); onLockChange(value);}} onExecution={focusExecution}/>
          </div>
        </details>
      </div>
      <aside className="min-w-0">
        <div className="rounded-[9px] border bg-card p-4">
          <h2 className="text-[17px] font-semibold">{l('taskInfo')}</h2>
          <div className="mt-3.5 grid gap-3 text-sm">
            <InfoRow label={l('project')} value={item.projectId ? project?.name ?? '—' : l('ungrouped')}/>
            <InfoRow label={l('creatorLabel')} value={item.createdBy ?? '—'}/>
            <InfoRow label={l('devEmployeeLabel')} value={empName(developerId) ?? l('unassigned')}/>
            <InfoRow label={l('reviewEmployeeLabel')} value={empName(reviewerId) ?? l('unassigned')}/>
          </div>
        </div>
      </aside>
    </div>
  </section>;
}