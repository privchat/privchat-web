import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {TaskHistory} from './task-history';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type Employee, type EmployeeConfig, type Execution, type Node } from './api';
import { ConsoleIntent } from './console-intent';
import { roomFailure } from './room-observer';
import { PlatformApiError, PlatformHttpError } from '@/lib/platform-errors';
import { usePageLabels } from './page-labels';

const field = 'block min-w-0 w-full rounded-md border bg-background px-3 py-2 text-sm';
const emptyConfig: EmployeeConfig = {name: '', nodeId: '', executor: '', roleDescription: '', title: '', model: '', workdirBindingId: ''};
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
function failureLabel(error: unknown): string {
  if (roomFailure(error) === 'denied') return 'denied';
  if ((error instanceof PlatformHttpError && [404, 405, 501].includes(error.status))
    || (error instanceof PlatformApiError && error.machineCode?.endsWith('_UNSUPPORTED'))) return 'unsupported';
  return 'error';
}

// Only verified executor names are selectable; arbitrary grants are not executor providers.
export function employeeExecutor(capability: string): string | undefined {
  if (capability === 'agent.claude') return 'claude';
  if (capability === 'agent.codex') return 'codex';
  return undefined;
}
export function availableEmployeeExecutors(node?: Node): string[] {
  return [...new Set(node?.granted.flatMap(c => node.capabilities?.some(a => a.name === c && a.available === true) ? employeeExecutor(c) ?? [] : []) ?? [])];
}
export function bindingCandidates(rows: Execution[], nodeId: string, executor: string, employees: Employee[], model: string, workdirBindingId: string): Execution[] {
  const sessions = new Map<string, Execution[]>();
  for (const row of rows) {
    if (row.nodeId !== nodeId || !row.nativeSessionId?.trim()) continue;
    const turns = sessions.get(row.nativeSessionId) ?? [];
    turns.push(row); sessions.set(row.nativeSessionId, turns);
  }
  const bound = new Set(employees.flatMap(a => a.executionId ?? []));
  return [...sessions.values()].flatMap(turns => {
    // An older terminal turn does not make a busy or employee-owned native session bindable.
    if (turns.some(e => !terminal.has(e.state) || !!e.agentId || bound.has(e.executionId)
      || e.scope?.kind !== 'private' || e.scope.ref !== '')) return [];
    const latest = [...turns].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
    return latest ? [latest] : [];
  }).filter(e => terminal.has(e.state)
    && e.scope?.kind === 'private' && e.scope.ref === '' && !e.agentId
    && e.params?.model === model && e.params?.workdirBindingId === workdirBindingId
    && employeeExecutor(e.capability ?? '') === executor)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function EmployeePanel({api, nodes, refreshNodes, renderSession, onRequestLockChange, workspaceMode = false}: {api: WorkspaceApi; nodes: Node[]; refreshNodes: () => Promise<void>; renderSession: (id: string) => ReactNode; onRequestLockChange: (locked: boolean) => void; workspaceMode?: boolean}) {
  const [historyEmployee, setHistoryEmployee] = useState<string>();
  const pageLabel = usePageLabels();
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState(false);
  const [config, setConfig] = useState<EmployeeConfig>({...emptyConfig});
  const [rows, setRows] = useState<Execution[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState(false);
  const [candidateRefresh, setCandidateRefresh] = useState(0);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [text, setText] = useState('');
  const [executionId, setExecutionId] = useState('');
  const intent = useRef(new ConsoleIntent());
  const live = useRef(true);
  const inFlight = useRef(false);
  const pendingAction = useRef<(() => Promise<void>) | undefined>(undefined);
  const employee = employees.find(a => a.agentId === selected);
  const nodeBound = !!employee?.nodeId?.trim();
  const node = nodes.find(n => n.nodeId === config.nodeId);
  const locked = busy || intent.current.hasPending;
  const candidates = bindingCandidates(rows, config.nodeId, config.executor, employees, config.model, config.workdirBindingId);
  const executors = availableEmployeeExecutors(node);
  const valid = Object.entries(config).filter(([k]) => k !== 'bindExecutionId').every(([,v]) => v.trim())
    && (editing || (node?.state === 'active' && executors.includes(config.executor) && node.workdirs?.some(w => w.id === config.workdirBindingId)))
    && (!config.bindExecutionId || (confirmed && candidates.some(e => e.executionId === config.bindExecutionId)));

  useEffect(() => {
    live.current = true;
    void api.employees().then(a => {if (live.current) {setEmployees(a); setReady(true);}}).catch(e => {if (live.current) setError(failureLabel(e));}).finally(() => {if (live.current) setLoading(false);});
    return () => {live.current = false; onRequestLockChange(false);};
  }, [api]);
  useEffect(() => {
    let active = true;
    setRows([]); setCandidatesError(false);
    if (workspaceMode || editing || !config.nodeId || !config.executor) {setCandidatesLoading(false); return;}
    setCandidatesLoading(true);
    void api.executions(config.nodeId).then(r => {if (active) setRows(r);}).catch(() => {if (active) setCandidatesError(true);}).finally(() => {if (active) setCandidatesLoading(false);});
    return () => {active = false;};
  }, [api, config.nodeId, config.executor, editing, candidateRefresh, workspaceMode]);

  function choose(id: string) {
    if (locked) return;
    setSelected(id); setEditing(false); setConfig({...emptyConfig}); setConfirmed(false);
    setExecutionId(employees.find(a => a.agentId === id)?.executionId ?? '');
    setText(''); setError(''); setSaved(false);
  }
  async function act(action: () => Promise<void>) {
    if (inFlight.current) return;
    pendingAction.current = action;
    onRequestLockChange(true);
    inFlight.current = true; setBusy(true); setError(''); setSaved(false);
    try {await action();} catch (e) {
      if (live.current) {
        const denied = roomFailure(e) === 'denied';
        setError(intent.current.hasPending ? 'unknown' : failureLabel(e));
        if (!intent.current.hasPending && failureLabel(e) === 'unsupported') setReady(false);
        if (denied) {setEmployees([]); setRows([]); setExecutionId(''); setReady(false);}
      }
    } finally {
      inFlight.current = false;
      onRequestLockChange(intent.current.hasPending);
      if (!intent.current.hasPending) pendingAction.current = undefined;
      if (live.current) setBusy(false);
    }
  }
  async function save() {
    const result = await intent.current.run<Employee>(api, editing ? '/agent/agents/update' : '/agent/agents',
      {...config, ...(editing ? {agentId: selected} : {})}, 'requestId');
    if (!live.current) return;
    setEmployees(old => [...old.filter(a => a.agentId !== result.agentId), result]);
    setReady(true);
    setSelected(result.agentId); setEditing(false); setExecutionId(result.executionId ?? ''); setSaved(true);
    setConfig({...emptyConfig}); setConfirmed(false);
  }
  if (historyEmployee) return <TaskHistory api={api} scope={{employeeId: historyEmployee}} renderSession={renderSession} onBack={() => setHistoryEmployee(undefined)}/>;
  return <section data-testid="employee-panel" className="min-w-0 space-y-3 border-t pt-4">
    {employee && <Button variant="outline" disabled={locked} onClick={() => setHistoryEmployee(employee.agentId)}>{pageLabel('taskRecords')}</Button>}
    <h3 className="font-semibold">{label('employees')}</h3>
    <p className="text-sm text-muted-foreground">{label('employeeHint')}</p>
    <p className="text-sm" data-testid="external-discovery-unsupported">{label('externalUnsupported')}</p>
    {error && <p role="alert">{label(error)}</p>}
    {intent.current.hasPending && <div className="space-y-2"><p className="text-sm">{label('retryRecovery')}</p><Button disabled={busy} onClick={() => {if (pendingAction.current) void act(pendingAction.current);}}>{label('retrySame')}</Button></div>}
    {saved && <p role="status">{label('employeeSaved')}</p>}
    {loading && <p role="status">{label('loading')}</p>}
    <Button variant="outline" disabled={locked || loading} onClick={() => void act(async () => {
      const [a] = await Promise.all([api.employees(), refreshNodes()]);
      if (live.current) {setEmployees(a); setReady(true); setExecutionId(a.find(e => e.agentId === selected)?.executionId ?? ''); setCandidateRefresh(n => n + 1);}
    })}>{label('refresh')}</Button>
    <label className="block">{label('employees')}<select className={field} value={selected} disabled={locked || !ready} onChange={e => choose(e.target.value)}>
      <option value="">{label('newEmployee')}</option>
      {employees.map(a => <option key={a.agentId} value={a.agentId}>{a.name} · {a.title} · {a.agentId}</option>)}
    </select></label>
    {ready && employees.length === 0 && <p>{label('empty')}</p>}
    {employee && <div className="space-y-2 rounded border p-3 text-sm break-words">
      <p>{employee.name} · {employee.title}</p><p className="whitespace-pre-wrap">{employee.roleDescription}</p>
      <p>{nodeBound ? employee.nodeId : label('unconfigured')} · {employee.executor} · {employee.model} · {employee.workdirBindingId}</p>
      <p>{workspaceMode ? pageLabel('privateNotImported') : `${label('managedSession')}: ${nodeBound ? executionId || label('sessionOnSend') : label('unconfigured')}`}</p>
      <Button variant="outline" disabled={locked || !ready || editing || !nodeBound} onClick={() => {
        setConfig({name: employee.name, title: employee.title, roleDescription: employee.roleDescription, nodeId: employee.nodeId!, executor: employee.executor, model: employee.model, workdirBindingId: employee.workdirBindingId});
        setEditing(true); setSaved(false);
      }}>{label('editEmployee')}</Button>
    </div>}
    {(!selected || editing) && <form className="space-y-3" onSubmit={e => {e.preventDefault(); if (!busy && (valid || intent.current.hasPending)) void act(save);}}>
      <fieldset disabled={locked || !ready} className="min-w-0 space-y-3">
        <label className="block">{label('name')}<input className={field} value={config.name} onChange={e => setConfig({...config, name: e.target.value})}/></label>
        <label className="block">{label('employeeTitle')}<input className={field} value={config.title} onChange={e => setConfig({...config, title: e.target.value})}/></label>
        <label className="block">{label('roleDescription')}<textarea className={field} value={config.roleDescription} onChange={e => setConfig({...config, roleDescription: e.target.value})}/></label>
        {editing ? <p className="text-sm">{label('routingFixed')}</p> : <>
          <label className="block">{label('nodes')}<select className={field} value={config.nodeId} onChange={e => {setConfig({...config, nodeId: e.target.value, executor: '', workdirBindingId: '', bindExecutionId: undefined}); setConfirmed(false);}}>
            <option value="">{label('nodes')}</option>{nodes.map(n => <option key={n.nodeId} value={n.nodeId} disabled={n.state !== 'active'}>{n.name} · {n.state} · {n.nodeId}</option>)}
          </select></label>
          <label className="block">{label('executor')}<select className={field} value={config.executor} onChange={e => {setConfig({...config, executor: e.target.value, bindExecutionId: undefined}); setConfirmed(false);}}>
            <option value="">{label('executor')}</option>{executors.map(e => <option key={e}>{e}</option>)}
          </select></label>
          <label className="block">{label('model')}<input className={field} value={config.model} onChange={e => {setConfig({...config, model: e.target.value, bindExecutionId: undefined}); setConfirmed(false);}}/></label>
          <label className="block">{label('workdir')}<select className={field} value={config.workdirBindingId} onChange={e => {setConfig({...config, workdirBindingId: e.target.value, bindExecutionId: undefined}); setConfirmed(false);}}>
            <option value="">{label('workdir')}</option>{node?.workdirs?.map(w => <option key={w.id} value={w.id}>{w.label} · {w.id}</option>)}
          </select></label>
          {node && (!node.workdirs?.length || !executors.length) && <p>{label('unconfigured')}</p>}
          <p className="text-sm">{workspaceMode ? pageLabel('privateNotImported') : label('bindingHint')}</p>
          {candidatesLoading && <p role="status">{label('loading')}</p>}
          {candidatesError && <p role="alert">{label('candidateError')}</p>}
          <label className="block">{label('managedSession')}<select className={field} value={config.bindExecutionId ?? ''} disabled={workspaceMode || candidatesLoading || candidatesError} onChange={e => {setConfig({...config, bindExecutionId: e.target.value || undefined}); setConfirmed(false);}}>
            <option value="">{label('sessionOnSend')}</option>{candidates.map(e => <option key={e.executionId} value={e.executionId}>{typeof e.params?.title === 'string' ? `${e.params.title} · ` : ''}{e.executionId} · {e.state} · {String(e.params?.model ?? '')} · {String(e.params?.workdirBindingId ?? '')}</option>)}
          </select></label>
          {config.bindExecutionId && <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>{label('confirmBinding')}</label>}
        </>}
      </fieldset>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={locked || !ready || !valid}>{label(editing ? 'saveEmployee' : 'newEmployee')}</Button>
        {editing && <Button type="button" variant="outline" disabled={locked} onClick={() => {setEditing(false); setConfig({...emptyConfig});}}>{label('back')}</Button>}
      </div>
    </form>}
    {employee && !editing && !workspaceMode && <>
      <label className="block">{label('employeeMessage')}<textarea className={field} value={text} disabled={locked || !nodeBound} onChange={e => setText(e.target.value)}/></label>
      <Button disabled={locked || !ready || !nodeBound || !text.trim()} onClick={() => {if (!nodeBound) return; void act(async () => {
        const result = await intent.current.run<Execution>(api, '/agent/agents/send', {agentId: employee.agentId, text}, 'requestId');
        if (!live.current) return;
        setExecutionId(result.executionId); setText('');
        setSelected(employee.agentId);
        setReady(true);
        setEmployees(old => [...old.filter(a => a.agentId !== employee.agentId), {...employee, executionId: result.executionId}]);
      });}}>{label('sendEmployee')}</Button>
      {nodeBound && executionId && renderSession(executionId)}
    </>}
  </section>;
}
