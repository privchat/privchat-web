import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type WorkItem, type WorkNote } from './api';
import { roomFailure } from './room-observer';

const field = 'block w-full min-w-0 rounded-[7px] border bg-background px-2.5 py-2 text-sm';
export function WorkItemPanel({api, item, notes, readOnly, refresh}: {api: WorkspaceApi; item: WorkItem; notes: WorkNote[]; readOnly: boolean; refresh: () => Promise<void>}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const [draft, setDraft] = useState<WorkItem>();
  const [kind, setKind] = useState('progress');
  const [body, setBody] = useState('');
  const [artifactRef, setArtifact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [added, setAdded] = useState<WorkNote[]>([]);
  const running = useRef(false);
  const disabled = readOnly || busy || uncertain;
  const terminal = ['done', 'cancelled'].includes(item.status);
  async function act(action: () => Promise<void>, append = false) {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); setError('');
    try {await action(); await refresh();} catch (e) {
      setError(roomFailure(e) === 'denied' ? 'denied' : 'itemError');
      // Notes have no idempotency key. Never offer a blind retry after a lost response.
      if (append) setUncertain(true);
    } finally {running.current = false; setBusy(false);}
  }
  return <section data-testid="work-item-panel" className="min-w-0 space-y-3 rounded-[9px] border bg-card p-4">
    <h3 className="text-[17px] font-semibold">{item.title}</h3><p className="text-sm text-muted-foreground">{label(`status_${item.status}`)} · v{item.version}</p>
    <p className="whitespace-pre-wrap break-words text-sm">{item.description}</p><h4 className="text-sm font-semibold">{label('acceptance')}</h4><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.acceptance}</p>
    {error && <p role="alert" className="text-sm text-destructive">{label(error)}</p>}
    {uncertain && <p role="status" className="text-sm text-muted-foreground">{label('noteUnknown')}</p>}
    {!draft && <Button variant="outline" size="sm" disabled={disabled} onClick={() => setDraft({...item})}>{label('editItem')}</Button>}
    {draft && <form className="space-y-2" onSubmit={e => {e.preventDefault(); void act(async () => {
      await api.put<WorkItem>('/workspace/work-item/update', {id: draft.id, version: draft.version, title: draft.title, description: draft.description, acceptance: draft.acceptance ?? '', projectId: draft.projectId ?? null});
      setDraft(undefined);
    });}}>
      <fieldset disabled={disabled} className="space-y-2">
        <label className="grid gap-1.5 text-sm font-medium">{label('name')}<input className={field} maxLength={200} value={draft.title} onChange={e => setDraft({...draft, title: e.target.value})}/></label>
        <label className="grid gap-1.5 text-sm font-medium">{label('description')}<textarea className={field} maxLength={10000} value={draft.description} onChange={e => setDraft({...draft, description: e.target.value})}/></label>
        <label className="grid gap-1.5 text-sm font-medium">{label('acceptance')}<textarea className={field} maxLength={10000} value={draft.acceptance ?? ''} onChange={e => setDraft({...draft, acceptance: e.target.value})}/></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDraft(undefined)}>{label('back')}</Button><Button disabled={!draft.title.trim()}>{label('saveItem')}</Button></div>
      </fieldset>
    </form>}
    <div className="flex flex-wrap gap-2">{!terminal && ['open', 'in_progress', 'done', 'cancelled'].filter(s => s !== item.status).map(status => <Button key={status} variant="outline" size="sm" disabled={disabled || !!draft} onClick={() => {
      if (window.confirm(label(status === 'done' ? 'acceptanceConfirm' : 'confirm'))) void act(async () => {
        await api.put('/workspace/work-item/update-status', {id: item.id, version: item.version, status});
      });
    }}>{label(`status_${status}`)}</Button>)}</div>
    <h4 className="text-sm font-semibold">{label('records')}</h4>
    <ol className="m-0 list-none p-0">{[...new Map([...notes, ...added].map(n => [n.id, n])).values()].map(n => <li key={n.id} className="relative ml-[13px] border-l pb-[18px] pl-[19px] last:pb-0">
      <span aria-hidden="true" className="absolute -left-[5px] top-1 h-[9px] w-[9px] rounded-full border bg-background" />
      <article className="rounded-[8px] border bg-sidebar p-3"><p className="text-xs text-muted-foreground">{label(`note_${n.kind}`)}</p><p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>{n.artifactRef && <code className="break-all text-xs">{n.artifactRef}</code>}</article>
    </li>)}</ol>
    <form className="space-y-2" onSubmit={e => {e.preventDefault(); void act(async () => {
      const note = await api.post<WorkNote>('/workspace/work-note/create', {workItemId: item.id, kind, body, artifactRef: artifactRef.trim() || null});
      setAdded(old => [...old, note]); setBody(''); setArtifact('');
    }, true);}}>
      <fieldset disabled={disabled} className="space-y-2">
        <label className="grid gap-1.5 text-sm font-medium">{label('noteKind')}<select className={field} value={kind} onChange={e => setKind(e.target.value)}>{['progress', 'decision', 'artifact', 'comment'].map(k => <option key={k} value={k}>{label(`note_${k}`)}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm font-medium">{label('noteBody')}<textarea className={field} maxLength={20000} value={body} onChange={e => setBody(e.target.value)}/></label>
        <label className="grid gap-1.5 text-sm font-medium">{label('artifactRef')}<input className={field} maxLength={500} value={artifactRef} onChange={e => setArtifact(e.target.value)}/></label>
        <div className="flex justify-end"><Button disabled={!body.trim() && !artifactRef.trim()}>{label('addNote')}</Button></div>
      </fieldset>
    </form>
  </section>;
}
