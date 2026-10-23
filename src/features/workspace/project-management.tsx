import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Node, Project, ProjectTarget, Workspace, WorkspaceApi } from './api';
import { usePageLabels } from './page-labels';
export const workspaceField = 'block w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm';

export function ProjectManagement({api, onBack}: {api: WorkspaceApi; onBack: () => void}) {
  const l = usePageLabels();
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [edit, setEdit] = useState<{id?: string; workspaceId: string; name: string; version?: number; targets: ProjectTarget[]}>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const generation = useRef(0);
  async function load(next = 1) {
    const current = ++generation.current; setBusy(true);
    try {
      const result = await api.projectPage(next, filter || undefined);
      if (generation.current !== current) return;
      setProjects(old => next === 1 ? result.list : [...old, ...result.list]); setPage(next); setTotal(result.total); setError(false);
    } catch {if (generation.current === current) setError(true);}
    finally {if (generation.current === current) setBusy(false);}
  }
  useEffect(() => {let live = true; void api.list().then(rows => {if (live) setSpaces(rows);}).catch(() => {if (live) setError(true);}); void api.nodes().then(rows => {if (live) setNodes(rows);}).catch(() => {if (live) setError(true);}); return () => {live = false; generation.current++;};}, [api]);
  useEffect(() => {void load(); return () => {generation.current++;};}, [api, filter]);
  const writable = (workspaceId: string) => spaces.some(s => s.id === workspaceId && s.archived === 0 && ['owner', 'admin', 'member'].includes(s.myRole));
  return <section data-testid="project-management" className="space-y-3">
    <header className="flex items-center justify-between"><Button variant="ghost" disabled={busy} onClick={onBack}>{l('back')}</Button><h2>{l('projects')}</h2><Button disabled={busy} onClick={() => {setEdit({workspaceId: filter, name: '', targets: []}); setStale(false);}}>{l('create')}</Button></header>
    {error && <p role="alert">{l(stale ? 'conflict' : 'error')}</p>}
    <label>{l('workspace')}<select aria-label={l('workspace')} className={workspaceField} value={filter} disabled={busy || !!edit} onChange={e => setFilter(e.target.value)}><option value="">{l('allProjects')}</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <Button variant="outline" disabled={busy} onClick={() => {setEdit(undefined); setStale(false); void load();}}>{l('reload')}</Button>
    {!edit && projects.map(project => <article key={project.id} className="space-y-2 rounded border p-3"><h3>{project.name} {project.archived !== 0 && l('archived')}</h3><p>v{project.version}</p>{!project.targets.length && <p>{l('noTargets')}</p>}<Button disabled={busy} onClick={async () => {setBusy(true); try {const p = await api.project(project.id); setEdit({...p}); setStale(false);} catch {setError(true);} finally {setBusy(false);}}}>{l('edit')}</Button><Button disabled={busy || !writable(project.workspaceId)} onClick={async () => {setBusy(true); try {await api.projectStatus(project.id, project.archived ? 0 : 1, project.version); await load();} catch {setError(true); setStale(true);} finally {setBusy(false);}}}>{l('archived')}</Button></article>)}
    {!edit && projects.length < total && <Button disabled={busy} onClick={() => void load(page + 1)}>{l('more')}</Button>}
    {edit && <form className="space-y-3 rounded border p-3" onSubmit={async e => {e.preventDefault(); if (busy || stale || !writable(edit.workspaceId)) return; setBusy(true); try {await api.saveProject({...edit, targets: edit.targets.map(({nodeId, workdirBindingId}) => ({nodeId, workdirBindingId}))}); setEdit(undefined); await load();} catch {setError(true); setStale(true);} finally {setBusy(false);}}}>
      <fieldset disabled={busy || stale} className="space-y-3">
        <label>{l('workspace')}<select required className={workspaceField} value={edit.workspaceId} disabled={!!edit.id} onChange={e => setEdit({...edit, workspaceId: e.target.value})}><option value="">{l('workspace')}</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>{l('name')}<input required maxLength={64} className={workspaceField} value={edit.name} onChange={e => setEdit({...edit, name: e.target.value})}/></label>
        <h3>{l('targets')}</h3>{edit.targets.length === 0 && <p>{l('noTargets')}</p>}
        {edit.targets.map((target, index) => <div key={index} className="flex flex-wrap gap-2 rounded border p-2">
          <label className="min-w-40 flex-1">{l('node')}<select required className={workspaceField} value={target.nodeId} onChange={e => setEdit({...edit, targets: edit.targets.map((t, i) => i === index ? {nodeId: e.target.value, workdirBindingId: ''} : t)})}><option value="">{l('node')}</option>{!nodes.some(n => n.nodeId === target.nodeId) && target.nodeId && <option value={target.nodeId}>{l('unavailable')}</option>}{nodes.map(n => <option key={n.nodeId} value={n.nodeId}>{n.name}</option>)}</select></label>
          <label className="min-w-40 flex-1">{l('workdir')}<select required className={workspaceField} value={target.workdirBindingId} onChange={e => setEdit({...edit, targets: edit.targets.map((t, i) => i === index ? {...t, workdirBindingId: e.target.value} : t)})}><option value="">{l('workdir')}</option>{target.workdirBindingId && !nodes.find(n => n.nodeId === target.nodeId)?.workdirs?.some(w => w.id === target.workdirBindingId) && <option value={target.workdirBindingId}>{l('unavailable')}</option>}{nodes.find(n => n.nodeId === target.nodeId)?.workdirs?.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</select></label>
          <Button type="button" variant="ghost" onClick={() => setEdit({...edit, targets: edit.targets.filter((_, i) => i !== index)})}>{l('remove')}</Button>
        </div>)}
        <Button type="button" variant="outline" onClick={() => setEdit({...edit, targets: [...edit.targets, {nodeId: '', workdirBindingId: ''}]})}>{l('addTarget')}</Button>
        <Button type="submit" disabled={!edit.name.trim() || !writable(edit.workspaceId) || edit.targets.some(t => !t.nodeId || !t.workdirBindingId) || new Set(edit.targets.map(t => `${t.nodeId}:${t.workdirBindingId}`)).size !== edit.targets.length}>{l('save')}</Button>
      </fieldset><Button type="button" variant="ghost" disabled={busy} onClick={() => setEdit(undefined)}>{l('cancel')}</Button>
    </form>}
  </section>;
}
