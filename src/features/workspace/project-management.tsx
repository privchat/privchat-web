import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Employee, Node, Project, ProjectBindingDirectoryWrite, Workspace, WorkspaceApi } from './api';
import { BINDING_DIRECTORY_LIMIT, BINDING_NOTES_LIMIT, ROUND_END_LIMIT } from './api';
import { TaskHistory } from './task-history';
import { usePageLabels } from './page-labels';
import { navigateWorkspace } from './routes';
import { roomFailure } from './room-observer';
import { WsPageHeader, WsTable, WsTd, WsTh } from './shell';
export const workspaceField = 'block w-full min-w-0 rounded-[7px] border bg-background px-2.5 py-2 text-sm';

export function ProjectList({api, workspaceId, renderSession}: {api: WorkspaceApi; workspaceId?: string; renderSession?: (id: string) => ReactNode}) {
  const l = usePageLabels();
  const [projects, setProjects] = useState<Project[]>([]);
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [history, setHistory] = useState<Project>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  async function load(next = 1) {
    const current = ++generation.current; setBusy(true);
    try {
      const result = await api.projectPage(next, workspaceId);
      if (generation.current !== current) return;
      setProjects(old => next === 1 ? result.list : [...old, ...result.list]); setPage(next); setTotal(result.total); setError(false);
    } catch {if (generation.current === current) setError(true);}
    finally {if (generation.current === current) setBusy(false);}
  }
  useEffect(() => {void load(); return () => {generation.current++;};}, [api, workspaceId]);
  useEffect(() => {void api.list().then(rows => setSpaces(rows)).catch(() => {});}, [api]);
  if (history) return <TaskHistory api={api} scope={{projectId: history.id}} projects={[history]} renderSession={renderSession} onBack={() => setHistory(undefined)}/>;
  return <section data-testid="project-management">
    <WsPageHeader title={l('projectsTitle')} subtitle={l('projectsSub')} actions={<>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => navigateWorkspace(workspaceId ? {view: 'space', spaceId: workspaceId} : {view: 'home'})}>{l('back')}</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>{l('reload')}</Button>
      <Button size="sm" disabled={busy} onClick={() => navigateWorkspace({view: 'create-project', workspaceId})}><Plus className="h-4 w-4" />{l('createProject')}</Button>
    </>} />
    {error && <p role="alert">{l('error')}</p>}
    <div className="mb-4"><select aria-label={l('workspace')} className={`${workspaceField} w-auto`} value={workspaceId ?? ''} onChange={e => navigateWorkspace({view: 'projects', workspaceId: e.target.value || undefined})}><option value="">{l('allProjects')}</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
    {!projects.length && <p role="status" className="py-6 text-sm text-muted-foreground">{l(busy ? 'loading' : 'empty')}</p>}
    {projects.length > 0 && <WsTable head={<>
      <WsTh>{l('project')}</WsTh><WsTh>{l('description')}</WsTh><WsTh>{l('colMyDirs')}</WsTh><WsTh className="text-right">{l('manage')}</WsTh>
    </>}>
      {projects.map(project => {
        const mine = project.bindings.find(b => b.mine);
        return <tr key={project.id} className="hover:bg-accent/40">
          <WsTd className="font-medium">{project.name}{project.archived !== 0 && <span className="ml-2 text-xs text-muted-foreground">{l('archived')}</span>}</WsTd>
          <WsTd className="text-muted-foreground">
            {project.description && <span className="block whitespace-pre-wrap break-words">{project.description}</span>}
            <span className="block text-xs">{spaces.find(s => s.id === project.workspaceId)?.name ?? project.workspaceId} · v{project.version}</span>
          </WsTd>
          <WsTd>{mine ? mine.directories.length : '—'}</WsTd>
          <WsTd className="text-right">
            <span className="inline-flex gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => navigateWorkspace({view: 'project', projectId: project.id})}>{l('edit')}</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setHistory(project)}>{l('taskRecords')}</Button>
            </span>
          </WsTd>
        </tr>;
      })}
    </WsTable>}
    {projects.length < total && <div className="pt-3"><Button variant="outline" size="sm" disabled={busy} onClick={() => void load(page + 1)}>{l('more')}</Button></div>}
  </section>;
}

export function ProjectCreate({api, workspaceId}: {api: WorkspaceApi; workspaceId?: string}) {
  const l = usePageLabels();
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState(workspaceId ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roundEnd, setRoundEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {let live = true; void api.list().then(rows => {if (live) setSpaces(rows);}).catch(() => {if (live) setError(true);}); return () => {live = false;};}, [api]);
  const manageable = spaces.filter(s => s.archived === 0 && ['owner', 'admin'].includes(s.myRole));
  return <form className="mx-auto max-w-lg space-y-4 rounded-lg border bg-card p-6" data-testid="project-create" onSubmit={async e => {e.preventDefault(); if (busy || !selected || !name.trim()) return; setBusy(true); setError(false); try {const project = await api.createProject({workspaceId: selected, name, description, roundEnd}); navigateWorkspace({view: 'project', projectId: project.id});} catch {setError(true);} finally {setBusy(false);}}}>
    <h2 className="text-lg font-bold">{l('createProject')}</h2>
    {error && <p role="alert">{l('error')}</p>}
    <fieldset disabled={busy} className="space-y-4">
      <label className="block space-y-1.5"><span className="text-sm font-medium">{l('workspace')}</span><select required className={workspaceField} value={selected} onChange={e => setSelected(e.target.value)}><option value="">{l('none')}</option>{manageable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="block space-y-1.5"><span className="text-sm font-medium">{l('name')}</span><input required maxLength={64} className={workspaceField} value={name} onChange={e => setName(e.target.value)}/></label>
      <label className="block space-y-1.5"><span className="text-sm font-medium">{l('description')}</span><textarea className={workspaceField} rows={3} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)}/></label>
      <label className="block space-y-1.5"><span className="text-sm font-medium">{l('roundEnd')}</span><textarea aria-label={l('roundEnd')} className={workspaceField} rows={3} placeholder={l('roundEndDefault')} value={roundEnd} onChange={e => setRoundEnd(e.target.value.slice(0, ROUND_END_LIMIT))}/></label>
      <p className="text-sm text-muted-foreground">{l('roundEndHint')}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" disabled={busy} onClick={() => navigateWorkspace({view: 'projects', workspaceId})}>{l('cancel')}</Button>
        <Button type="submit" disabled={busy || !selected || !name.trim()}>{l('save')}</Button>
      </div>
    </fieldset>
  </form>;
}

interface BindingDraft {id?: string; version?: number; nodeId: string; directories: ProjectBindingDirectoryWrite[]; notes: string; reviewerEmployeeId: string}

export function ProjectDetail({api, projectId, renderSession}: {api: WorkspaceApi; projectId: string; renderSession?: (id: string) => ReactNode}) {
  const l = usePageLabels();
  const [project, setProject] = useState<Project>();
  const [space, setSpace] = useState<Workspace>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [edit, setEdit] = useState<{name: string; description: string; roundEnd: string}>();
  const [draft, setDraft] = useState<BindingDraft>();
  const [history, setHistory] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  async function load() {
    const current = await api.project(projectId);
    if (!live.current) return;
    setProject(current); setEdit({name: current.name, description: current.description, roundEnd: current.roundEnd}); setStale(false);
    const [owner, n, e] = await Promise.all([api.space(current.workspaceId), api.nodes(), api.employees()]);
    if (!live.current) return;
    setSpace(owner); setNodes(n); setEmployees(e);
  }
  useEffect(() => {
    live.current = true; setProject(undefined); setEdit(undefined); setDraft(undefined); setError(false); setDenied(false);
    void load().catch(e => {if (!live.current) return; if (roomFailure(e) === 'denied') setDenied(true); setError(true);});
    return () => {live.current = false;};
  }, [api, projectId]);
  async function act(action: () => Promise<unknown>, conflict = false) {
    if (busy) return;
    setBusy(true); setError(false); setStale(false);
    try {await action(); await load();} catch {if (live.current) {setError(true); setStale(conflict);}} finally {if (live.current) setBusy(false);}
  }
  if (history && project) return <TaskHistory api={api} scope={{projectId: project.id}} projects={[project]} renderSession={renderSession} onBack={() => setHistory(false)}/>;
  const mine = project?.bindings.find(b => b.mine);
  const canBind = !!space && space.archived === 0 && project?.archived === 0 && ['owner', 'admin', 'member'].includes(space.myRole);
  const workdirs = nodes.find(n => n.nodeId === draft?.nodeId)?.workdirs ?? [];
  const reviewerCandidates = employees.filter(e => e.nodeId === draft?.nodeId && draft?.directories.some(d => d.workdirBindingId === e.workdirBindingId));
  const accessLabel = (access: string) => access === 'write' ? l('accessWrite') : l('accessRead');
  return <section data-testid="project-detail" className="space-y-3">
    <WsPageHeader title={project?.name ?? projectId} subtitle={project ? `v${project.version}${project.archived !== 0 ? ` · ${l('archived')}` : ''}` : undefined} actions={<>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => navigateWorkspace({view: 'projects', workspaceId: project?.workspaceId})}>{l('back')}</Button>
      <Button variant="outline" size="sm" disabled={busy || !project} onClick={() => void load().catch(() => setError(true))}>{l('reload')}</Button>
    </>} />
    {error && <p role="alert">{l(denied ? 'accessDenied' : stale ? 'conflict' : 'error')}</p>}
    {!project && !error && <p role="status">{l('loading')}</p>}
    {project && <>
      <p className="text-sm text-muted-foreground">v{project.version}{project.archived !== 0 && ` · ${l('archived')}`}</p>
      {project.description && <p className="whitespace-pre-wrap break-words text-sm">{project.description}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => setHistory(true)}>{l('taskRecords')}</Button>
        {project.manageable && <Button variant="outline" disabled={busy} onClick={() => void act(() => api.projectStatus(project.id, project.archived ? 0 : 1, project.version), true)}>{l('archived')}</Button>}
      </div>
      {project.manageable && edit && <form className="space-y-3 rounded border p-3" onSubmit={e => {e.preventDefault(); if (!edit.name.trim()) return; void act(() => api.updateProject({id: project.id, name: edit.name, version: project.version, description: edit.description, roundEnd: edit.roundEnd}), true);}}>
        <fieldset disabled={busy || stale || project.archived !== 0} className="space-y-3">
          <label>{l('name')}<input required maxLength={64} className={workspaceField} value={edit.name} onChange={e => setEdit({...edit, name: e.target.value})}/></label>
          <label>{l('description')}<textarea className={workspaceField} rows={3} maxLength={2000} value={edit.description} onChange={e => setEdit({...edit, description: e.target.value})}/></label>
          <label>{l('roundEnd')}<textarea aria-label={l('roundEnd')} className={workspaceField} rows={3} placeholder={l('roundEndDefault')} value={edit.roundEnd} onChange={e => setEdit({...edit, roundEnd: e.target.value.slice(0, ROUND_END_LIMIT)})}/></label>
          <p className="text-sm text-muted-foreground">{l('roundEndHint')}</p>
          <Button type="submit" disabled={busy || stale || !edit.name.trim()}>{l('save')}</Button>
        </fieldset>
      </form>}
      <section className="space-y-2 rounded border p-3" aria-label={l('binding')}>
        <h3 className="font-semibold">{l('myBinding')}</h3>
        <p className="text-sm text-muted-foreground">{l('bindingHint')}</p>
        {!draft && mine && <article className="space-y-1 rounded border p-2">
          <p>{mine.nodeName}</p>
          <p className="text-sm">{mine.directories.map(d => `${d.label} · ${accessLabel(d.access)}`).join('; ')}</p>
          {mine.notes && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{mine.notes}</p>}
          {mine.reviewerEmployeeId && <p className="text-sm">{l('defaultReviewer')}: {mine.reviewerEmployeeId}</p>}
          {canBind && <Button variant="outline" disabled={busy} onClick={() => setDraft({id: mine.id, version: mine.version, nodeId: mine.nodeId ?? '', directories: mine.directories.filter(d => d.workdirBindingId).map(d => ({workdirBindingId: d.workdirBindingId!, access: d.access})), notes: mine.notes ?? '', reviewerEmployeeId: mine.reviewerEmployeeId ?? ''})}>{l('edit')}</Button>}
        </article>}
        {!draft && !mine && <p>{l('noBinding')}</p>}
        {!draft && canBind && !mine && <Button disabled={busy} onClick={() => setDraft({nodeId: '', directories: [], notes: '', reviewerEmployeeId: ''})}>{l('create')}</Button>}
        {draft && <form className="space-y-3" onSubmit={e => {e.preventDefault(); if (!draft.nodeId || !draft.directories.length) return; void act(async () => {await api.saveProjectBinding({projectId: project.id, nodeId: draft.nodeId, directories: draft.directories, notes: draft.notes, reviewerEmployeeId: draft.reviewerEmployeeId || null, ...(draft.version === undefined ? {} : {version: draft.version})}); setDraft(undefined);}, true);}}>
          <fieldset disabled={busy || stale} className="space-y-3">
            <label>{l('node')}<select required className={workspaceField} value={draft.nodeId} onChange={e => setDraft({...draft, nodeId: e.target.value, directories: [], reviewerEmployeeId: ''})}><option value="">{l('none')}</option>{draft.nodeId && !nodes.some(n => n.nodeId === draft.nodeId) && <option value={draft.nodeId}>{l('unavailable')}</option>}{nodes.map(n => <option key={n.nodeId} value={n.nodeId}>{n.name}</option>)}</select></label>
            <h4>{l('directories')}</h4>
            {draft.directories.map((directory, index) => <div key={directory.workdirBindingId} className="flex flex-wrap items-center gap-2 rounded border p-2">
              <span className="min-w-0 flex-1 break-words text-sm">{workdirs.find(w => w.id === directory.workdirBindingId)?.label ?? directory.workdirBindingId}</span>
              <select aria-label={l('access')} className={workspaceField} value={directory.access} onChange={e => setDraft({...draft, directories: draft.directories.map((d, i) => i === index ? {...d, access: e.target.value as 'write' | 'read'} : d)})}><option value="write">{l('accessWrite')}</option><option value="read">{l('accessRead')}</option></select>
              <Button type="button" variant="ghost" onClick={() => setDraft({...draft, directories: draft.directories.filter((_, i) => i !== index), reviewerEmployeeId: ''})}>{l('remove')}</Button>
            </div>)}
            {draft.directories.length < BINDING_DIRECTORY_LIMIT && <label>{l('addDirectory')}<select className={workspaceField} value="" disabled={!draft.nodeId} onChange={e => {if (e.target.value) setDraft({...draft, directories: [...draft.directories, {workdirBindingId: e.target.value, access: 'write'}]});}}><option value="">{l('none')}</option>{workdirs.filter(w => !draft.directories.some(d => d.workdirBindingId === w.id)).map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</select></label>}
            <label>{l('notes')}<textarea className={workspaceField} rows={2} maxLength={BINDING_NOTES_LIMIT} value={draft.notes} onChange={e => setDraft({...draft, notes: e.target.value})}/></label>
            <label>{l('defaultReviewer')}<select aria-label={l('defaultReviewer')} className={workspaceField} value={draft.reviewerEmployeeId} onChange={e => setDraft({...draft, reviewerEmployeeId: e.target.value})}><option value="">{l('none')}</option>{draft.reviewerEmployeeId && !reviewerCandidates.some(e => e.agentId === draft.reviewerEmployeeId) && <option value={draft.reviewerEmployeeId} disabled>{draft.reviewerEmployeeId} · {l('unavailable')}</option>}{reviewerCandidates.map(e => <option key={e.agentId} value={e.agentId}>{e.name}</option>)}</select><span className="text-xs text-muted-foreground">{l('defaultReviewerHint')}</span></label>
            <Button type="submit" disabled={busy || stale || !draft.nodeId || !draft.directories.length}>{l('save')}</Button>
            {draft.id && <Button type="button" variant="destructive" disabled={busy || stale} onClick={() => {if (window.confirm(l('deleteBindingConfirm'))) void act(async () => {await api.deleteProjectBinding(draft.id!); setDraft(undefined);}, true);}}>{l('deleteBinding')}</Button>}
          </fieldset>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(undefined)}>{l('cancel')}</Button>
        </form>}
      </section>
      <section className="space-y-2" aria-label={l('otherBindings')}>
        <h3 className="font-semibold">{l('otherBindings')}</h3>
        {!project.bindings.some(b => !b.mine) && <p className="text-sm text-muted-foreground">{l('empty')}</p>}
        {project.bindings.filter(b => !b.mine).map(binding => <article key={binding.id} className="space-y-1 rounded border p-2">
          <p>{binding.nodeName}</p>
          <p className="text-sm text-muted-foreground">{binding.directories.map(d => `${d.label} · ${accessLabel(d.access)}`).join('; ')}</p>
        </article>)}
      </section>
    </>}
  </section>;
}
