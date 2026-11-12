import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import type { PrivchatClient } from '@privchat/sdk';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Project, Workspace, WorkspaceActivity, WorkspaceApi, WorkspaceSummary } from './api';
import { usePageLabels } from './page-labels';
import { ProjectCreate, ProjectDetail, ProjectList, workspaceField } from './project-management';
import { SpaceSettings } from './space-settings';
import { DevicePage } from './devices';
import { TaskFeed } from './task-feed-view';
import { CreateItem } from './create-item';
import { SpaceEmployees } from './space-employees';
import { WorkDetails } from './work-details';
import { WorkspaceInbox } from './inbox';
import { roomFailure } from './room-observer';
import { navigateWorkspace, parseWorkspaceRoute, scopedWorkspaceRoute, workspaceHref, type WorkspaceRoute } from './routes';
import { WorkspaceShell, WsChip, WsChipGroup, WsPageHeader } from './shell';
import type { TaskStatusCategory } from './task-stage';

// Survives the account-switch remount (AppProviders is keyed by account) but not a
// page refresh, so deep links survive reload while a switch drops scoped routes.
let lastWorkspaceAccount: string | null | undefined;

export function WorkspacePage({api, client, accountKey, renderSession, onLockChange}: {api: WorkspaceApi; client?: PrivchatClient; accountKey?: string | null; renderSession: (id: string) => ReactNode; onLockChange: (locked: boolean) => void}) {
  const [route, setRoute] = useState<WorkspaceRoute>(() => parseWorkspaceRoute(location.hash) ?? {view: 'home'});
  useEffect(() => {
    const change = () => setRoute(parseWorkspaceRoute(location.hash) ?? {view: 'home'});
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const previous = lastWorkspaceAccount;
    lastWorkspaceAccount = accountKey;
    if (previous !== undefined && previous !== accountKey) {
      const current = parseWorkspaceRoute(location.hash);
      if (current && scopedWorkspaceRoute(current)) navigateWorkspace({view: 'home'});
    }
  }, [accountKey]);
  let view: ReactNode;
  switch (route.view) {
    case 'projects': view = <ProjectList key={workspaceHref(route)} api={api} workspaceId={route.workspaceId} renderSession={renderSession}/>; break;
    case 'create-project': view = <ProjectCreate key={workspaceHref(route)} api={api} workspaceId={route.workspaceId}/>; break;
    case 'project': view = <ProjectDetail key={route.projectId} api={api} projectId={route.projectId} renderSession={renderSession}/>; break;
    case 'devices': view = <DevicePage api={api} onBack={() => navigateWorkspace({view: 'home'})}/>; break;
    case 'create-space': view = <CreateSpace api={api}/>; break;
    case 'space':
    case 'records': view = <SpaceView key={route.spaceId} api={api} client={client} spaceId={route.spaceId} records={route.view === 'records'}/>; break;
    case 'create-item': view = <CreateItem key={route.spaceId} api={api} workspaceId={route.spaceId} onBack={() => navigateWorkspace({view: 'space', spaceId: route.spaceId})} onCreated={() => navigateWorkspace({view: 'space', spaceId: route.spaceId})} onLockChange={onLockChange}/>; break;
    case 'item': view = <ItemRoute key={`${route.spaceId}:${route.itemId}:${route.executionId ?? ''}`} api={api} spaceId={route.spaceId} itemId={route.itemId} executionId={route.executionId} renderSession={renderSession} onLockChange={onLockChange}/>; break;
    case 'employees': view = <SpaceEmployees key={route.spaceId} api={api} workspaceId={route.spaceId} renderSession={renderSession} onBack={() => navigateWorkspace({view: 'space', spaceId: route.spaceId})} onLockChange={onLockChange}/>; break;
    case 'settings': view = <SpaceSettings key={route.spaceId} api={api} workspaceId={route.spaceId} onBack={() => navigateWorkspace({view: 'space', spaceId: route.spaceId})}/>; break;
    default: view = <SpaceHome api={api}/>;
  }
  return <WorkspaceShell api={api} route={route}>{view}</WorkspaceShell>;
}

function SpaceHome({api}: {api: WorkspaceApi}) {
  const l = usePageLabels();
  const [spaces, setSpaces] = useState<WorkspaceSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  async function load(next = 1) {
    const current = ++generation.current; setBusy(true);
    try {
      const result = await api.spaces(next);
      if (!Array.isArray(result.list) || typeof result.total !== 'number') throw new Error('Invalid workspace page');
      if (generation.current !== current) return;
      setSpaces(old => next === 1 ? result.list : [...old, ...result.list]); setPage(next); setTotal(result.total); setError(false);
    } catch {if (generation.current === current) setError(true);}
    finally {if (generation.current === current) setBusy(false);}
  }
  useEffect(() => {void load(); return () => {generation.current++;};}, [api]);
  return <section data-testid="workspace-home">
    <WsPageHeader title={l('home')} subtitle={l('spacesSub')} actions={<>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>{l('reload')}</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm">{l('manage')}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => navigateWorkspace({view: 'projects'})}>{l('projects')}</DropdownMenuItem><DropdownMenuItem onSelect={() => navigateWorkspace({view: 'devices'})}>{l('devices')}</DropdownMenuItem><DropdownMenuItem onSelect={() => navigateWorkspace({view: 'create-space'})}>{l('createSpace')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      <Button size="sm" onClick={() => navigateWorkspace({view: 'create-space'})}><Plus className="h-4 w-4" />{l('createSpace')}</Button>
    </>} />
    {error && <p role="alert">{l('error')}</p>}
    {!spaces.length && <p role="status" className="py-6 text-sm text-muted-foreground">{l(busy ? 'loading' : 'empty')}</p>}
    {spaces.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{spaces.map(s => <button key={s.id} type="button" data-testid="workspace-card" className="min-w-0 space-y-3 rounded-[9px] border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2" onClick={() => navigateWorkspace({view: 'space', spaceId: s.id})}>
      <h3 className="truncate font-semibold">{s.name}{s.archived !== 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{l('archived')}</span>}</h3>
      {s.description && <p className="truncate text-sm text-muted-foreground">{s.description}</p>}
      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground"><span>{l('employees')}: {s.employeeCount}</span><span>{l('available')}: {s.employeeAvailabilityKnown && s.availableEmployeeCount != null ? s.availableEmployeeCount : l('unavailable')}</span><span>{l('open')}: {s.openItemCount}</span></div>
      {s.lastActivityAt != null && <p className="text-xs text-muted-foreground">{l('activity')}: {new Date(s.lastActivityAt).toLocaleString()}</p>}
    </button>)}</div>}
    {spaces.length < total && <div className="pt-3"><Button variant="outline" size="sm" disabled={busy} onClick={() => void load(page + 1)}>{l('more')}</Button></div>}
  </section>;
}

function CreateSpace({api}: {api: WorkspaceApi}) {
  const l = usePageLabels();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return <form className="mx-auto max-w-lg space-y-4 rounded-lg border bg-card p-6" onSubmit={async e => {e.preventDefault(); if (busy) return; setBusy(true); try {await api.post('/workspace/create', {name, description}); navigateWorkspace({view: 'home'});} catch {setError(true);} finally {setBusy(false);}}}>
    <h2 className="text-lg font-bold">{l('createSpace')}</h2>{error && <p role="alert">{l('error')}</p>}
    <label className="block space-y-1.5"><span className="text-sm font-medium">{l('name')}</span><input className={workspaceField} required maxLength={120} value={name} onChange={e => setName(e.target.value)}/></label>
    <label className="block space-y-1.5"><span className="text-sm font-medium">{l('description')}</span><textarea className={workspaceField} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)}/></label>
    <div className="flex justify-end gap-2">
      <Button variant="outline" type="button" disabled={busy} onClick={() => navigateWorkspace({view: 'home'})}>{l('cancel')}</Button>
      <Button disabled={busy || !name.trim()} type="submit">{l('save')}</Button>
    </div>
  </form>;
}

function SpaceView({api, client, spaceId, records}: {api: WorkspaceApi; client?: PrivchatClient; spaceId: string; records: boolean}) {
  const l = usePageLabels();
  const [space, setSpace] = useState<Workspace>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatusCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [historyEmployee, setHistoryEmployee] = useState('');
  const [unprojected, setUnprojected] = useState(false);
  const [recordsVisited, setRecordsVisited] = useState(records);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const readOnly = !space || space.archived !== 0 || !['owner', 'admin', 'member'].includes(space.myRole);
  async function load() {
    setBusy(true);
    try {
      const [current, rows] = await Promise.all([api.space(spaceId), api.projects(spaceId)]);
      if (!live.current) return;
      setSpace(current); setProjects(rows); setError(false); setDenied(false);
    } catch (e) {
      if (!live.current) return;
      if (roomFailure(e) === 'denied') {setDenied(true); setSpace(undefined); setProjects([]);}
      setError(true);
    } finally {if (live.current) setBusy(false);}
  }
  useEffect(() => {live.current = true; void load(); return () => {live.current = false;};}, [api, spaceId]);
  useEffect(() => {if (records) setRecordsVisited(true);}, [records]);
  const open = (row: WorkspaceActivity) => navigateWorkspace({view: 'item', spaceId, itemId: row.item.id, executionId: row.latestExecution?.executionId ?? undefined});
  return <section data-testid="workspace-detail">
    <WsPageHeader title={l('tasksTitle')} subtitle={l('tasksSub')} actions={<>
      <Button variant="ghost" size="sm" onClick={() => navigateWorkspace({view: 'home'})}>{l('back')}</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={l('manage')}><MoreHorizontal className="h-5 w-5"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem disabled={readOnly} onSelect={() => navigateWorkspace({view: 'create-item', spaceId})}>{l('createItem')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigateWorkspace({view: 'employees', spaceId})}>{l('manageEmployees')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigateWorkspace({view: 'projects', workspaceId: spaceId})}>{l('projects')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigateWorkspace({view: 'settings', spaceId})}>{l('settings')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <Button size="sm" disabled={readOnly} onClick={() => navigateWorkspace({view: 'create-item', spaceId})}><Plus className="h-4 w-4" />{l('newTask')}</Button>
    </>} />
    {error && <p role="alert">{l(denied ? 'accessDenied' : 'error')}</p>}
    {!space && !error && <p role="status" className="py-6 text-sm text-muted-foreground">{l(busy ? 'loading' : 'empty')}</p>}
    {space && <>
      {readOnly && <p className="mb-3 text-sm text-muted-foreground">{l('readOnly')}</p>}
      <WorkspaceInbox key={`inbox:${spaceId}`} api={api} workspaceId={spaceId}/>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <WsChipGroup label={l('taskViews')}>
            <WsChip active={!records} onClick={() => navigateWorkspace({view: 'space', spaceId})}>{l('unfinished')}</WsChip>
            <WsChip active={records} onClick={() => navigateWorkspace({view: 'records', spaceId})}>{l('taskRecords')}</WsChip>
          </WsChipGroup>
          <WsChipGroup label={l('colStatus')}>
            {([['all', 'statusAll'], ['pending', 'statusPending'], ['running', 'statusRunning'], ['review', 'statusReview'], ['done', 'statusDone']] as const).map(([key, label]) => <WsChip key={key} active={statusFilter === key} onClick={() => setStatusFilter(key)}>{l(label)}</WsChip>)}
          </WsChipGroup>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={l('project')} className={`${workspaceField} w-auto`} value={projectId} onChange={e => {setProjectId(e.target.value); setUnprojected(false);}}><option value="">{l('allProjects')}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input aria-label={l('searchTasks')} placeholder={l('searchTasks')} className={`${workspaceField} w-48`} value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
      </div>
      {records && <div className="mb-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm">{l('employeeFilter')}<input className={`${workspaceField} w-40`} value={historyEmployee} onChange={e => setHistoryEmployee(e.target.value)}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unprojected} onChange={e => {setUnprojected(e.target.checked); setProjectId('');}}/>{l('ungrouped')}</label></div>}
      <div hidden={records}><TaskFeed key={`active:${spaceId}:${projectId}`} api={api} client={client} workspaceId={spaceId} projectId={projectId || undefined} view="active" enabled={!records} projects={projects} onOpen={open} statusFilter={statusFilter} search={search}/></div>
      {recordsVisited && <div hidden={!records}><TaskFeed key={`records:${spaceId}:${projectId}:${historyEmployee}:${unprojected}`} api={api} client={client} workspaceId={spaceId} projectId={unprojected ? undefined : projectId || undefined} employeeId={historyEmployee || undefined} unprojected={unprojected} view="history" enabled={records} projects={projects} onOpen={open} statusFilter={statusFilter} search={search}/></div>}
    </>}
  </section>;
}

function ItemRoute({api, spaceId, itemId, executionId, renderSession, onLockChange}: {api: WorkspaceApi; spaceId: string; itemId: string; executionId?: string; renderSession: (id: string) => ReactNode; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [row, setRow] = useState<WorkspaceActivity>();
  const [space, setSpace] = useState<Workspace>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true; setRow(undefined); setSpace(undefined); setError(false);
    void Promise.all([api.item(itemId), api.space(spaceId)]).then(([item, current]) => {
      if (!live) return;
      if (item.workspaceId !== spaceId) throw new Error('Work item unavailable');
      setSpace(current);
      setRow({item, latestExecution: executionId ? {id: '', executionId, state: null} : null, executionCount: 0});
    }).catch(() => {if (live) setError(true);});
    return () => {live = false;};
  }, [api, spaceId, itemId, executionId]);
  const back = () => navigateWorkspace({view: 'space', spaceId});
  if (error) return <section className="space-y-3"><Button variant="ghost" onClick={back}>{l('back')}</Button><p role="alert">{l('error')}</p></section>;
  if (!row || !space) return <section className="space-y-3"><Button variant="ghost" onClick={back}>{l('back')}</Button><p role="status">{l('loading')}</p></section>;
  const readOnly = space.archived !== 0 || !['owner', 'admin', 'member'].includes(space.myRole);
  return <WorkDetails key={itemId} api={api} row={row} readOnly={readOnly} onBack={back} renderSession={renderSession} onLockChange={onLockChange}/>;
}
