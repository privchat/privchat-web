import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Workspace, WorkspaceApi } from './api';
import { usePageLabels } from './page-labels';
import { workspaceField } from './project-management';
import { roomFailure } from './room-observer';
import { StatusPill, WsPageHeader } from './shell';

export function SpaceSettings({api, workspaceId, onUpdated}: {api: WorkspaceApi; workspaceId: string; onUpdated: () => void}) {
  const l = usePageLabels();
  const [space, setSpace] = useState<Workspace>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const live = useRef(true);
  const canManage = !!space && ['owner', 'admin'].includes(space.myRole);
  const manager = canManage && space.archived === 0;
  async function load() {
    setBusy(true);
    try {
      const current = await api.space(workspaceId);
      if (!live.current) return;
      setSpace(current); setName(current.name); setDescription(current.description); setError(false); setDenied(false);
    } catch (e) {
      if (!live.current) return;
      if (roomFailure(e) === 'denied') setDenied(true);
      setError(true);
    } finally {if (live.current) setBusy(false);}
  }
  useEffect(() => {live.current = true; void load(); return () => {live.current = false;};}, [api, workspaceId]);
  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError(false); setSaved(false);
    try {await action(); if (live.current) {onUpdated(); await load();}} catch {if (live.current) setError(true);} finally {if (live.current) setBusy(false);}
  }
  return <section data-testid="space-settings">
    <WsPageHeader title={l('settings')} subtitle={l('spaceSettingsSub')} />
    {error && <p role="alert">{l(denied ? 'accessDenied' : 'error')}</p>}
    {space && <form data-testid="space-profile" className="max-w-xl space-y-4" onSubmit={e => {e.preventDefault(); if (!manager || !name.trim()) return; void act(async () => {await api.updateSpace({id: space.id, name: name.trim(), description: description.trim()}); setSaved(true);});}}>
      <fieldset disabled={busy || !manager} className="space-y-3">
        <label className="grid gap-1.5 text-sm font-medium">{l('name')}
          <input required maxLength={64} className={workspaceField} value={name} onChange={e => {setName(e.target.value); setSaved(false);}}/>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">{l('description')}
          <textarea rows={3} maxLength={500} aria-label={l('description')} className={workspaceField} value={description} onChange={e => {setDescription(e.target.value); setSaved(false);}}/>
        </label>
        {manager && <Button type="submit" disabled={busy || !name.trim()}>{l('save')}</Button>}
      </fieldset>
      {space.archived !== 0 && <div className="space-y-2"><StatusPill>{l('archived')}</StatusPill><p className="text-sm text-muted-foreground">{l('readOnly')}</p></div>}
      {saved && <p role="status" className="text-sm text-muted-foreground">{l('spaceSaved')}</p>}
      {canManage && <div className="border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={() => {
        const archiving = space.archived === 0;
        if (window.confirm(l(archiving ? 'archiveSpaceConfirm' : 'restoreSpaceConfirm'))) void act(() => api.spaceStatus(space.id, archiving ? 1 : 0));
      }}>{l(space.archived === 0 ? 'archiveSpace' : 'restoreSpace')}</Button></div>}
    </form>}
    {!space && !error && <p role="status" className="text-sm text-muted-foreground">{l('loading')}</p>}
  </section>;
}
