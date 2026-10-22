import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type WorkItem, type WorkNote } from './api';
import { roomFailure } from './room-observer';

const field = 'block w-full min-w-0 rounded border bg-background px-3 py-2 text-sm';
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
  return <section data-testid="work-item-panel" className="min-w-0 space-y-3 rounded border p-3">
    <h3 className="font-semibold">{item.title}</h3><p>{label(`status_${item.status}`)} · v{item.version}</p>
    <p className="whitespace-pre-wrap break-words">{item.description}</p><h4>{label('acceptance')}</h4><p className="whitespace-pre-wrap break-words">{item.acceptance}</p>
    {error && <p role="alert">{label(error)}</p>}
    {uncertain && <p role="status">{label('noteUnknown')}</p>}
    {!draft && <Button variant="outline" disabled={disabled} onClick={() => setDraft({...item})}>{label('editItem')}</Button>}
    {draft && <form className="space-y-2" onSubmit={e => {e.preventDefault(); void act(async () => {
      await api.put<WorkItem>('/workspace/work-item/update', {id: draft.id, version: draft.version, title: draft.title, description: draft.description, acceptance: draft.acceptance ?? '', projectId: draft.projectId ?? null});
      setDraft(undefined);
    });}}>
      <fieldset disabled={disabled} className="space-y-2">
        <label className="block">{label('name')}<input className={field} maxLength={200} value={draft.title} onChange={e => setDraft({...draft, title: e.target.value})}/></label>
        <label className="block">{label('description')}<textarea className={field} maxLength={10000} value={draft.description} onChange={e => setDraft({...draft, description: e.target.value})}/></label>
        <label className="block">{label('acceptance')}<textarea className={field} maxLength={10000} value={draft.acceptance ?? ''} onChange={e => setDraft({...draft, acceptance: e.target.value})}/></label>
        <Button disabled={!draft.title.trim()}>{label('saveItem')}</Button>
        <Button type="button" variant="outline" onClick={() => setDraft(undefined)}>{label('back')}</Button>
      </fieldset>
    </form>}
    {!terminal && ['open', 'in_progress', 'done', 'cancelled'].filter(s => s !== item.status).map(status => <Button key={status} variant="outline" disabled={disabled || !!draft} onClick={() => {
      if (window.confirm(label(status === 'done' ? 'acceptanceConfirm' : 'confirm'))) void act(async () => {
        await api.put('/workspace/work-item/update-status', {id: item.id, version: item.version, status});
      });
    }}>{label(`status_${status}`)}</Button>)}
    <h4>{label('records')}</h4>
    {[...new Map([...notes, ...added].map(n => [n.id, n])).values()].map(n => <article className="rounded border p-2" key={n.id}><p className="text-xs text-muted-foreground">{label(`note_${n.kind}`)}</p><p className="whitespace-pre-wrap break-words">{n.body}</p>{n.artifactRef && <code className="break-all">{n.artifactRef}</code>}</article>)}
    <form className="space-y-2" onSubmit={e => {e.preventDefault(); void act(async () => {
      const note = await api.post<WorkNote>('/workspace/work-note/create', {workItemId: item.id, kind, body, artifactRef: artifactRef.trim() || null});
      setAdded(old => [...old, note]); setBody(''); setArtifact('');
    }, true);}}>
      <fieldset disabled={disabled} className="space-y-2">
        <label className="block">{label('noteKind')}<select className={field} value={kind} onChange={e => setKind(e.target.value)}>{['progress', 'decision', 'artifact', 'comment'].map(k => <option key={k} value={k}>{label(`note_${k}`)}</option>)}</select></label>
        <label className="block">{label('noteBody')}<textarea className={field} maxLength={20000} value={body} onChange={e => setBody(e.target.value)}/></label>
        <label className="block">{label('artifactRef')}<input className={field} maxLength={500} value={artifactRef} onChange={e => setArtifact(e.target.value)}/></label>
        <Button disabled={!body.trim() && !artifactRef.trim()}>{label('addNote')}</Button>
      </fieldset>
    </form>
  </section>;
}
