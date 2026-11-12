import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Member, Workspace, WorkspaceApi } from './api';
import { usePageLabels } from './page-labels';
import { workspaceField } from './project-management';
import { roomFailure } from './room-observer';

export function SpaceSettings({api, workspaceId, onBack}: {api: WorkspaceApi; workspaceId: string; onBack: () => void}) {
  const l = usePageLabels();
  const [space, setSpace] = useState<Workspace>();
  const [members, setMembers] = useState<Member[]>([]);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const live = useRef(true);
  const manager = !!space && space.archived === 0 && ['owner', 'admin'].includes(space.myRole);
  const roleLabel = (value: string) => value === 'owner' ? l('roleOwner') : value === 'admin' ? l('roleAdmin') : l('roleMember');
  async function load() {
    setBusy(true);
    try {
      const [current, rows] = await Promise.all([api.space(workspaceId), api.members(workspaceId)]);
      if (!live.current) return;
      setSpace(current); setMembers(rows); setError(false); setDenied(false);
    } catch (e) {
      if (!live.current) return;
      if (roomFailure(e) === 'denied') setDenied(true);
      setError(true);
    } finally {if (live.current) setBusy(false);}
  }
  useEffect(() => {live.current = true; void load(); return () => {live.current = false;};}, [api, workspaceId]);
  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError(false);
    try {await action(); await load();} catch {if (live.current) setError(true);} finally {if (live.current) setBusy(false);}
  }
  return <section data-testid="space-settings" className="space-y-3">
    <header className="flex items-center justify-between gap-2"><Button variant="ghost" disabled={busy} onClick={onBack}>{l('back')}</Button><h2 className="font-semibold">{l('settings')}</h2><Button variant="outline" disabled={busy} onClick={() => void load()}>{l('reload')}</Button></header>
    {error && <p role="alert">{l(denied ? 'accessDenied' : 'error')}</p>}
    {space && <p className="text-sm text-muted-foreground">{space.name}{space.archived !== 0 && ` · ${l('archived')}`}</p>}
    <h3>{l('members')}</h3>
    {!members.length && <p role="status">{l(busy ? 'loading' : 'empty')}</p>}
    {members.map(member => <article key={member.id} className="flex flex-wrap items-center gap-2 rounded border p-3">
      <span className="min-w-0 flex-1 break-words">{member.userId}</span>
      {manager && member.role !== 'owner'
        ? <select aria-label={l('memberRole')} className={workspaceField} disabled={busy} value={member.role} onChange={e => void act(() => api.updateMemberRole(member.id, e.target.value))}>
            <option value="member">{l('roleMember')}</option><option value="admin">{l('roleAdmin')}</option>
          </select>
        : <span className="text-sm text-muted-foreground">{roleLabel(member.role)}</span>}
      {manager && member.role !== 'owner' && <Button variant="outline" disabled={busy} onClick={() => {if (window.confirm(l('removeMemberConfirm'))) void act(() => api.removeMember(member.id));}}>{l('removeMember')}</Button>}
    </article>)}
    {manager && <form className="space-y-2 rounded border p-3" onSubmit={e => {e.preventDefault(); if (!userId.trim()) return; void act(async () => {await api.addMember(workspaceId, userId.trim(), role); setUserId('');});}}>
      <h4>{l('addMember')}</h4>
      <label>{l('userId')}<input className={workspaceField} required value={userId} onChange={e => setUserId(e.target.value)}/></label>
      <label>{l('memberRole')}<select className={workspaceField} value={role} onChange={e => setRole(e.target.value)}><option value="member">{l('roleMember')}</option><option value="admin">{l('roleAdmin')}</option></select></label>
      <Button type="submit" disabled={busy || !userId.trim()}>{l('addMember')}</Button>
    </form>}
  </section>;
}