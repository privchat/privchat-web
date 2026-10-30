import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { Employee, Node, Project, ProjectTarget, WorkspaceApi } from './api';
import {TaskHistory} from './task-history';
import { usePageLabels } from './page-labels';
export const workspaceField = 'block w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm';

export function ProjectManagement({api, onBack, renderSession}: {api: WorkspaceApi; renderSession?: (id: string) => ReactNode; onBack: () => void}) {
  const l = usePageLabels();
  const [history, setHistory] = useState<Project>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [reviewers, setReviewers] = useState<Employee[]>([]);
  const [reviewersReady, setReviewersReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [edit, setEdit] = useState<{id?: string; writable: boolean; name: string; version?: number; targets: ProjectTarget[]; basis: string}>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const generation = useRef(0);
  async function load(next = 1) {
    const current = ++generation.current; setBusy(true);
    try {
      const result = await api.projectPage(next);
      if (generation.current !== current) return;
      setProjects(old => next === 1 ? result.list : [...old, ...result.list]); setPage(next); setTotal(result.total); setError(false);
    } catch {if (generation.current === current) setError(true);}
    finally {if (generation.current === current) setBusy(false);}
  }
  useEffect(() => {if (!edit) return; let live = true; void api.nodes().then(rows => {if (live) setNodes(rows);}).catch(() => {if (live) setError(true);}); return () => {live = false;};}, [api, !!edit]);
  useEffect(() => {
    if (!edit) return;
    let live = true; setReviewers([]); setReviewersReady(false);
    void api.employees().then(rows => {
      if (!Array.isArray(rows)) throw new Error('Invalid employee catalog');
      if (live) {setReviewers(rows); setReviewersReady(true);}
    }).catch(() => {if (live) setError(true);});
    return () => {live = false;};
  }, [api, edit?.id, !!edit]);
  useEffect(() => {void load(); return () => {generation.current++;};}, [api]);
  if (history) return <TaskHistory api={api} scope={{projectId: history.id}} projects={[history]} renderSession={renderSession} onBack={() => setHistory(undefined)}/>;
  return <section data-testid="project-management" className="space-y-3">
    <header className="flex items-center justify-between"><Button variant="ghost" disabled={busy} onClick={onBack}>{l('back')}</Button><h2>{l('projects')}</h2><Button disabled={busy} onClick={() => {setEdit({writable: true, name: '', targets: [], basis: ''}); setStale(false);}}>{l('create')}</Button></header>
    {error && <p role="alert">{l(stale ? 'conflict' : 'error')}</p>}
    <Button variant="outline" disabled={busy} onClick={() => {setEdit(undefined); setStale(false); void load();}}>{l('reload')}</Button>
    {!edit && projects.map(project => <article key={project.id} className="space-y-2 rounded border p-3"><h3>{project.name} {project.archived !== 0 && l('archived')}</h3><p>v{project.version}</p><Button variant="outline" disabled={busy} onClick={() => setHistory(project)}>{l('taskRecords')}</Button>{!project.targets.length && <p>{l('noTargets')}</p>}<Button disabled={busy || !project.writable || project.archived !== 0} onClick={async () => {setBusy(true); try {const p = await api.project(project.id); setEdit({...p, basis: (p.reviewBasis ?? []).join('\n')}); setStale(false);} catch {setError(true);} finally {setBusy(false);}}}>{l('edit')}</Button><Button disabled={busy || !project.writable} onClick={async () => {setBusy(true); try {await api.projectStatus(project.id, project.archived ? 0 : 1, project.version); await load();} catch {setError(true); setStale(true);} finally {setBusy(false);}}}>{l('archived')}</Button></article>)}
    {!edit && projects.length < total && <Button disabled={busy} onClick={() => void load(page + 1)}>{l('more')}</Button>}
    {edit && <form className="space-y-3 rounded border p-3" onSubmit={async e => {e.preventDefault(); if (busy || stale || !edit.writable) return; setBusy(true); try {await api.saveProject({id: edit.id, name: edit.name, version: edit.version, targets: edit.targets.map(({nodeId, workdirBindingId, reviewerEmployeeId}) => ({nodeId, workdirBindingId, reviewerEmployeeId})), reviewBasis: edit.basis.split('\n')}); setEdit(undefined); await load();} catch {setError(true); setStale(true);} finally {setBusy(false);}}}>
      <fieldset disabled={busy || stale || !edit.writable} className="space-y-3">
        <label>{l('name')}<input required maxLength={64} className={workspaceField} value={edit.name} onChange={e => setEdit({...edit, name: e.target.value})}/></label>
        <label>{l('reviewBasis')}<textarea aria-label={l('reviewBasis')} className={workspaceField} rows={3} placeholder="SPEC.md" value={edit.basis} onChange={e => setEdit({...edit, basis: e.target.value.slice(0, 5000)})}/></label>
        <p className="text-sm text-muted-foreground">{l('reviewBasisHint')}</p>
        <h3>{l('targets')}</h3>{edit.targets.length === 0 && <p>{l('noTargets')}</p>}
        {edit.targets.map((target, index) => <div key={index} className="flex flex-wrap gap-2 rounded border p-2">
          <label className="min-w-40 flex-1">{l('node')}<select required className={workspaceField} value={target.nodeId} onChange={e => setEdit({...edit, targets: edit.targets.map((t, i) => i === index ? {nodeId: e.target.value, workdirBindingId: ''} : t)})}><option value="">{l('node')}</option>{!nodes.some(n => n.nodeId === target.nodeId) && target.nodeId && <option value={target.nodeId}>{l('unavailable')}</option>}{nodes.map(n => <option key={n.nodeId} value={n.nodeId}>{n.name}</option>)}</select></label>
          <label className="min-w-40 flex-1">{l('workdir')}<select required className={workspaceField} value={target.workdirBindingId} onChange={e => setEdit({...edit, targets: edit.targets.map((t, i) => i === index ? {...t, workdirBindingId: e.target.value} : t)})}><option value="">{l('workdir')}</option>{target.workdirBindingId && !nodes.find(n => n.nodeId === target.nodeId)?.workdirs?.some(w => w.id === target.workdirBindingId) && <option value={target.workdirBindingId}>{l('unavailable')}</option>}{nodes.find(n => n.nodeId === target.nodeId)?.workdirs?.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</select></label>
          <label className="min-w-40 flex-1">{l('targetReviewer')}<select aria-label={l('targetReviewer')} className={workspaceField} disabled={!reviewersReady || !target.workdirBindingId} value={target.reviewerEmployeeId ?? ''} onChange={e => setEdit({...edit, targets: edit.targets.map((t, i) => i === index ? {...t, reviewerEmployeeId: e.target.value || null} : t)})}>
            <option value="">{l('none')}</option>
            {target.reviewerEmployeeId && !reviewers.some(row => row.agentId === target.reviewerEmployeeId && row.nodeId === target.nodeId && row.workdirBindingId === target.workdirBindingId) && <option value={target.reviewerEmployeeId} disabled>{target.reviewerEmployeeId} · {l('unavailable')}</option>}
            {reviewers.filter(row => row.nodeId === target.nodeId && row.workdirBindingId === target.workdirBindingId).map(row => <option key={row.agentId} value={row.agentId}>{row.name}</option>)}
          </select><span className="text-xs text-muted-foreground">{l('targetReviewerHint')}</span></label>
          <Button type="button" variant="ghost" onClick={() => setEdit({...edit, targets: edit.targets.filter((_, i) => i !== index)})}>{l('remove')}</Button>
        </div>)}
        <Button type="button" variant="outline" onClick={() => setEdit({...edit, targets: [...edit.targets, {nodeId: '', workdirBindingId: ''}]})}>{l('addTarget')}</Button>
        <Button type="submit" disabled={!edit.name.trim() || !edit.writable || edit.targets.some(t => !t.nodeId || !t.workdirBindingId) || new Set(edit.targets.map(t => `${t.nodeId}:${t.workdirBindingId}`)).size !== edit.targets.length}>{l('save')}</Button>
      </fieldset><Button type="button" variant="ghost" disabled={busy} onClick={() => setEdit(undefined)}>{l('cancel')}</Button>
    </form>}
  </section>;
}
