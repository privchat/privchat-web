import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Member, Workspace, WorkspaceApi } from './api';
import { usePageLabels } from './page-labels';
import { workspaceField } from './project-management';
import { roomFailure } from './room-observer';
import { StatusPill, WsPageHeader, WsTable, WsTd, WsTh } from './shell';

export function SpaceSettings({api, workspaceId}: {api: WorkspaceApi; workspaceId: string}) {
  const l = usePageLabels();
  const [space, setSpace] = useState<Workspace>();
  const [members, setMembers] = useState<Member[]>([]);
  const [invite, setInvite] = useState(false);
  const [preview, setPreview] = useState(false);
  const [manageId, setManageId] = useState<string>();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const live = useRef(true);
  const manager = !!space && space.archived === 0 && ['owner', 'admin'].includes(space.myRole);
  const managed = members.find(m => m.id === manageId);
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
  return <section data-testid="space-settings">
    <WsPageHeader title={l('membersTitle')} subtitle={l('membersSub')} actions={manager && <Button size="sm" disabled={busy} onClick={() => {setUserId(''); setRole('member'); setPreview(false); setInvite(true); setManageId(undefined);}}><Plus className="h-4 w-4" />{l('inviteMember')}</Button>} />
    {error && <p role="alert">{l(denied ? 'accessDenied' : 'error')}</p>}
    {manager && <Dialog open={invite} onOpenChange={open => {if (!busy) {setInvite(open); if (!open) setPreview(false);}}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{l(preview ? 'previewInvite' : 'inviteMember')}</DialogTitle>
          <DialogDescription>{l('inviteMemberHint')}</DialogDescription>
        </DialogHeader>
        {preview ? <form className="space-y-4" onSubmit={e => {e.preventDefault(); if (!userId.trim()) return; void act(async () => {await api.addMember(workspaceId, userId.trim(), role); setUserId(''); setPreview(false); setInvite(false);});}}>
          <div className="grid gap-1.5 text-sm font-medium">{l('account')}
            <p className="break-words rounded-[7px] border bg-background px-2.5 py-2 text-sm font-normal">{userId.trim()}</p>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">{l('memberRole')}
            <select aria-label={l('memberRole')} className={workspaceField} value={role} disabled={busy} onChange={e => setRole(e.target.value)}><option value="member">{l('roleMember')}</option><option value="admin">{l('roleAdmin')}</option></select>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setPreview(false)}>{l('back')}</Button>
            <Button type="submit" disabled={busy || !userId.trim()}>{l('sendInvite')}</Button>
          </DialogFooter>
        </form> : <form className="space-y-4" onSubmit={e => {e.preventDefault(); if (userId.trim()) setPreview(true);}}>
          <label className="grid gap-1.5 text-sm font-medium">{l('account')}
            <input autoFocus className={`${workspaceField} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`} required value={userId} disabled={busy} onChange={e => setUserId(e.target.value)}/>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setInvite(false)}>{l('cancel')}</Button>
            <Button type="submit" disabled={busy || !userId.trim()}>{l('previewInvite')}</Button>
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>}
    {manager && managed && <section className="space-y-3 rounded border p-3" aria-label={l('manage')}>
      <h3 className="font-semibold">{managed.userId}</h3>
      <label className="block space-y-1.5"><span className="text-sm font-medium">{l('memberRole')}</span><select aria-label={l('memberRole')} className={workspaceField} disabled={busy} value={managed.role} onChange={e => void act(() => api.updateMemberRole(managed.id, e.target.value))}><option value="member">{l('roleMember')}</option><option value="admin">{l('roleAdmin')}</option></select></label>
      <div className="flex gap-2">
        <Button variant="destructive" disabled={busy} onClick={() => {if (window.confirm(l('removeMemberConfirm'))) void act(async () => {await api.removeMember(managed.id); setManageId(undefined);});}}>{l('removeMember')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setManageId(undefined)}>{l('cancel')}</Button>
      </div>
    </section>}
    {!members.length && <p role="status" className="py-6 text-sm text-muted-foreground">{l(busy ? 'loading' : 'empty')}</p>}
    {members.length > 0 && <WsTable head={<><WsTh>{l('members')}</WsTh><WsTh>{l('memberRole')}</WsTh></>}>
      {members.map(member => <tr key={member.id} className="hover:bg-accent/40">
        <WsTd>{manager && member.role !== 'owner'
          ? <button type="button" className="font-semibold hover:underline focus-visible:underline" onClick={() => {setManageId(member.id); setInvite(false);}}>{member.userId}</button>
          : <span className="font-semibold">{member.userId}</span>}</WsTd>
        <WsTd><StatusPill><span aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-current" />{roleLabel(member.role)}</StatusPill></WsTd>
      </tr>)}
    </WsTable>}
  </section>;
}