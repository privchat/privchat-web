import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { PrivchatClient } from '@privchat/sdk';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Project, WorkspaceActivity, WorkspaceApi, WorkspaceSummary } from './api';
import { usePageLabels } from './page-labels';
import { ProjectManagement, workspaceField } from './project-management';
import { DevicePage } from './devices';
import { TaskFeed } from './task-feed-view';
import { CreateItem } from './create-item';
import { SpaceEmployees } from './space-employees';
import { WorkDetails } from './work-details';

export function WorkspacePage({api, client, renderSession, onLockChange}: {api: WorkspaceApi; client?: PrivchatClient; renderSession: (id: string) => ReactNode; onLockChange: (locked: boolean) => void}) {
  const l = usePageLabels();
  const [spaces, setSpaces] = useState<WorkspaceSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [route, setRoute] = useState<'home' | 'projects' | 'devices' | 'create-space' | 'space' | 'create-item' | 'employees'>('home');
  const [space, setSpace] = useState<WorkspaceSummary>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [historyEmployee, setHistoryEmployee] = useState('');
  const [unprojected, setUnprojected] = useState(false);
  const [records, setRecords] = useState(false);
  const [recordsVisited, setRecordsVisited] = useState(false);
  const [detail, setDetail] = useState<WorkspaceActivity>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState(false);
  const generation = useRef(0);
  const readOnly = !space || space.archived !== 0 || !['owner', 'admin', 'member'].includes(space.myRole);
  function lock(value: boolean) {setLocked(value); onLockChange(value);}
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
  useEffect(() => {
    let active = true; setProjects([]);
    if (space) void api.projects(space.id).then(rows => {if (active) setProjects(rows);}).catch(() => {if (active) setError(true);});
    return () => {active = false;};
  }, [api, space?.id, revision]);
  if (route === 'projects') return <ProjectManagement api={api} renderSession={renderSession} onBack={() => {setRoute('home'); void load();}}/>;
  if (route === 'devices') return <DevicePage api={api} onBack={() => {setRoute('home'); void load();}}/>;
  if (route === 'create-item' && space) return <CreateItem api={api} workspaceId={space.id} onBack={() => setRoute('space')} onCreated={() => {setRevision(r => r + 1); setRoute('space');}} onLockChange={lock}/>;
  if (route === 'employees' && space) return <SpaceEmployees api={api} renderSession={renderSession} workspaceId={space.id} readOnly={readOnly} onBack={() => {setRoute('space'); setRevision(r => r + 1);}} onLockChange={lock}/>;
  if (route === 'create-space') return <form className="space-y-3" onSubmit={async e => {e.preventDefault(); if (busy) return; setBusy(true); try {await api.post('/workspace/create', {name, description}); setName(''); setDescription(''); setRoute('home'); await load();} catch {setError(true);} finally {setBusy(false);}}}>
    <h2>{l('createSpace')}</h2>{error && <p role="alert">{l('error')}</p>}
    <label>{l('name')}<input className={workspaceField} required maxLength={120} value={name} onChange={e => setName(e.target.value)}/></label>
    <label>{l('description')}<textarea className={workspaceField} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)}/></label>
    <Button disabled={busy || !name.trim()} type="submit">{l('save')}</Button><Button variant="ghost" type="button" disabled={busy} onClick={() => setRoute('home')}>{l('cancel')}</Button>
  </form>;
  if (route === 'space' && space) return <section className="space-y-3" data-testid="workspace-detail">
    <header className="flex items-center justify-between gap-2"><Button variant="ghost" disabled={locked} onClick={() => {setSpace(undefined); setRoute('home'); setDetail(undefined); setProjectId(''); setSettings(false); void load();}}>{l('back')}</Button><h2 className="min-w-0 flex-1 truncate font-semibold">{space.name}</h2>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={locked} aria-label={l('manage')}><MoreHorizontal className="h-5 w-5"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={readOnly} onSelect={() => setRoute('create-item')}>{l('createItem')}</DropdownMenuItem><DropdownMenuItem onSelect={() => setRoute('employees')}>{l('manageEmployees')}</DropdownMenuItem><DropdownMenuItem onSelect={() => setSettings(value => !value)}>{l('settings')}</DropdownMenuItem><DropdownMenuItem onSelect={() => {setRecords(true); setRecordsVisited(true); setDetail(undefined);}}>{l('taskRecords')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </header>{readOnly && <p>{l('readOnly')}</p>}
    {settings && <WorkspaceProjectLinks key={space.id} api={api} workspace={space} onLockChange={lock} onChanged={removedId => {if (removedId === projectId) setProjectId(''); setRevision(value => value + 1);}}/>}
    <div hidden={!!detail}>
      <div className="flex gap-2" role="group" aria-label={l('taskViews')}>
        <Button variant="outline" aria-pressed={!records} onClick={() => setRecords(false)}>{l('unfinished')}</Button>
        <Button variant="outline" aria-pressed={records} onClick={() => {setRecords(true); setRecordsVisited(true);}}>{l('taskRecords')}</Button>
      </div>
      <label>{l('project')}<select className={workspaceField} value={projectId} onChange={e => {setProjectId(e.target.value); setUnprojected(false);}}><option value="">{l('allProjects')}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {records && <div className="flex flex-wrap gap-2"><label>{l('employeeFilter')}<input className={workspaceField} value={historyEmployee} onChange={e => setHistoryEmployee(e.target.value)}/></label><label><input type="checkbox" checked={unprojected} onChange={e => {setUnprojected(e.target.checked); setProjectId('');}}/>{l('ungrouped')}</label></div>}
      <div hidden={records}><TaskFeed key={`active:${space.id}:${projectId}:${revision}`} api={api} client={client} workspaceId={space.id} projectId={projectId || undefined} view="active" enabled={!records && !detail} projects={projects} onOpen={setDetail}/></div>
      {recordsVisited && <div hidden={!records}><TaskFeed key={`records:${space.id}:${projectId}:${historyEmployee}:${unprojected}:${revision}`} api={api} client={client} workspaceId={space.id} projectId={unprojected ? undefined : projectId || undefined} employeeId={historyEmployee || undefined} unprojected={unprojected} view="history" enabled={records && !detail} projects={projects} onOpen={setDetail}/></div>}
    </div>
    {detail && <WorkDetails key={detail.item.id} api={api} row={detail} readOnly={readOnly} onBack={() => setDetail(undefined)} renderSession={renderSession} onLockChange={lock}/>}
  </section>;
  return <section data-testid="workspace-home" className="space-y-4">
    <header className="flex items-center justify-between"><h2 className="text-lg font-semibold">{l('home')}</h2><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">{l('manage')}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setRoute('projects')}>{l('projects')}</DropdownMenuItem><DropdownMenuItem onSelect={() => setRoute('devices')}>{l('devices')}</DropdownMenuItem><DropdownMenuItem onSelect={() => {setError(false); setRoute('create-space');}}>{l('createSpace')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></header>
    {error && <p role="alert">{l('error')}</p>}
    <Button variant="outline" disabled={busy} onClick={() => void load()}>{l('reload')}</Button>
    {!spaces.length && <p role="status">{l(busy ? 'loading' : 'empty')}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{spaces.map(s => <button key={s.id} type="button" data-testid="workspace-card" className="min-w-0 space-y-3 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2" onClick={() => {setSpace(s); setProjectId(''); setRecords(false); setRecordsVisited(false); setHistoryEmployee(''); setUnprojected(false); setRoute('space');}}>
      <h3 className="truncate font-semibold">{s.name} {s.archived !== 0 && <span className="text-xs text-muted-foreground">{l('archived')}</span>}</h3>
      {s.description && <p className="truncate text-sm text-muted-foreground">{s.description}</p>}
      <div className="flex flex-wrap gap-3 text-sm"><span>{l('employees')}: {s.employeeCount}</span><span>{l('available')}: {s.employeeAvailabilityKnown && s.availableEmployeeCount != null ? s.availableEmployeeCount : l('unavailable')}</span><span>{l('open')}: {s.openItemCount}</span></div>
      {s.lastActivityAt != null && <p className="text-xs text-muted-foreground">{l('activity')}: {new Date(s.lastActivityAt).toLocaleString()}</p>}
    </button>)}</div>
    {spaces.length < total && <Button disabled={busy} onClick={() => void load(page + 1)}>{l('more')}</Button>}
  </section>;
}

function WorkspaceProjectLinks({api, workspace, onLockChange, onChanged}: {api: WorkspaceApi; workspace: WorkspaceSummary; onLockChange: (locked: boolean) => void; onChanged: (removedId?: string) => void}) {
  const l = usePageLabels();
  const manager = workspace.archived === 0 && ['owner', 'admin'].includes(workspace.myRole);
  const [linked, setLinked] = useState<Project[]>([]);
  const [candidates, setCandidates] = useState<Project[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const live = useRef(false);
  const running = useRef(false);
  async function load(next = 1) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(false);
    try {
      const [links, result] = await Promise.all([
        api.projectLinks(workspace.id),
        manager ? api.projectPage(next) : Promise.resolve({list: [], total: 0}),
      ]);
      if (!live.current) return;
      setLinked(links);
      setCandidates(old => next === 1 ? result.list : [...old, ...result.list]);
      setPage(next); setHasMore(next * 20 < result.total); setReady(true);
    } catch {if (live.current) {setError(true); setReady(false);}}
    finally {running.current = false; if (live.current) setBusy(false);}
  }
  useEffect(() => {live.current = true; void load(); return () => {live.current = false;};}, [api, workspace.id, manager]);
  async function change(project: Project, unlink: boolean) {
    if (running.current || !ready || !manager || (!unlink && !project.manageable)) return;
    running.current = true; setBusy(true); setError(false); onLockChange(true);
    try {
      if (unlink) await api.unlinkProject(workspace.id, project.id);
      else await api.linkProject(workspace.id, project.id);
      if (live.current) onChanged(unlink ? project.id : undefined);
      const links = await api.projectLinks(workspace.id);
      if (live.current) setLinked(links);
    } catch {if (live.current) {setError(true); setReady(false);}}
    finally {running.current = false; onLockChange(false); if (live.current) setBusy(false);}
  }
  return <section data-testid="workspace-project-links" className="space-y-3 rounded border p-3" aria-label={l('settings')}>
    <h3>{l('settings')}</h3><p>{l('unlinkProjectHint')}</p>
    {error && <p role="alert">{l('error')}</p>}
    {busy && <p role="status">{l('loading')}</p>}
    <Button variant="outline" disabled={busy} onClick={() => void load()}>{l('reload')}</Button>
    <h4>{l('linkedProjects')}</h4>
    {ready && !linked.length && <p>{l('empty')}</p>}
    {linked.map(project => <article key={project.id} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 flex-1 break-words">{project.name}</span><Button disabled={busy || !ready || !manager} onClick={() => void change(project, true)}>{l('unlinkProject')}</Button></article>)}
    {manager && <><h4>{l('projectCandidates')}</h4>
      {candidates.filter(project => project.manageable && project.archived === 0 && !linked.some(link => link.id === project.id)).map(project => <article key={project.id} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 flex-1 break-words">{project.name}</span><Button disabled={busy || !ready} onClick={() => void change(project, false)}>{l('linkProject')}</Button></article>)}
      {hasMore && <Button disabled={busy || !ready} onClick={() => void load(page + 1)}>{l('more')}</Button>}
    </>}
  </section>;
}
