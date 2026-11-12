import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WorkspaceApi, type Node, type PairingView } from './api';
import { roomFailure } from './room-observer';
import { usePageLabels } from './page-labels';
import { StatusPill, WsPageHeader, WsTable, WsTd, WsTh, wsField } from './shell';

const known = new Set(['agent.codex', 'agent.claude', 'workspace_events_read']);

export function DevicePage({api, onBack}: {api: WorkspaceApi; onBack: () => void}) {
  const {t, i18n} = useTranslation();
  const l = usePageLabels();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [selected, setSelected] = useState('');
  const [grants, setGrants] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState<PairingView>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(false);
  const running = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const node = nodes.find(n => n.nodeId === selected);
  const date = (value?: number | null) => value ? new Date(value).toLocaleString(i18n.resolvedLanguage) : label('empty');
  const accept = (n: Node) => {setNodes(old => old.map(x => x.nodeId === n.nodeId ? n : x)); setGrants(n.granted);};
  const selectNode = (id: string) => {setSelected(id); setGrants(nodes.find(n => n.nodeId === id)?.granted ?? []);};
  async function refresh() {
    const rows = await api.nodes();
    if (!live.current) return;
    setNodes(rows);
    setGrants(rows.find(n => n.nodeId === selected)?.granted ?? []);
  }
  useEffect(() => {
    live.current = true;
    void api.nodes().then(rows => {if (live.current) setNodes(rows);})
      .catch(e => {if (live.current) setError(roomFailure(e) === 'denied' ? 'denied' : 'error');})
      .finally(() => {if (live.current) setLoading(false);});
    return () => {live.current = false;};
  }, [api]);
  async function act(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try {await action();} catch (e) {
      if (live.current) {
        const denied = roomFailure(e) === 'denied';
        setError(denied ? 'denied' : 'error');
        if (denied) {setNodes([]); setSelected(''); setGrants([]); setPairing(undefined);}
      }
    } finally {running.current = false; if (live.current) setBusy(false);}
  }
  return <main data-testid="device-page" className="w-full min-w-0">
    <WsPageHeader title={l('devicesTitle')} subtitle={l('devicesSub')} actions={<>
      <Button variant="ghost" disabled={busy} onClick={onBack}>{label('back')}</Button>
      <Button variant="outline" disabled={busy || loading} onClick={() => void act(refresh)}>{label('refresh')}</Button>
      <Button disabled={busy} onClick={() => codeRef.current?.focus()}><Plus className="h-4 w-4" />{l('addDevice')}</Button>
    </>} />
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{label(error)}</p>}
    {loading && <p role="status" className="mb-3 text-sm text-muted-foreground">{label('loading')}</p>}
    <form className="rounded-[9px] border bg-card p-4" onSubmit={e => {e.preventDefault(); if (code.trim() && window.confirm(label('pairingConfirm'))) void act(async () => {
      const result = await api.approvePairing(code.trim());
      if (live.current) {setPairing(result); setCode('');}
      await refresh();
    });}}>
      <h2 className="text-[17px] font-semibold">{label('pairing')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{label('pairingHint')}</p>
      <label className="mt-3 grid gap-1.5 text-sm font-medium">{label('pairingCode')}
        <input ref={codeRef} autoComplete="off" className={wsField} value={code} disabled={busy} onChange={e => {setCode(e.target.value); setPairing(undefined);}} />
      </label>
      <div className="mt-3"><Button disabled={busy || !code.trim()}>{label('approvePairing')}</Button></div>
      {pairing && <div role="status" className="mt-3 break-words text-sm text-muted-foreground"><p>{label('pairingApproved')}</p><p>{pairing.deviceName} · {pairing.platform} · {pairing.runtimeVersion}</p><p>{label('expiresAt')}: {date(pairing.expiresAt)}</p></div>}
    </form>
    <label className="mt-[22px] grid max-w-sm gap-1.5 text-sm font-medium">{label('nodes')}
      <select className={wsField} value={selected} disabled={busy} onChange={e => selectNode(e.target.value)}>
        <option value="">{label('nodes')}</option>{nodes.map(n => <option key={n.nodeId} value={n.nodeId}>{n.name} · {n.state} · {n.nodeId}</option>)}
      </select>
    </label>
    {!loading && !nodes.length && <div className="mt-[22px] rounded-[9px] border py-[58px] text-center text-muted-foreground">
      <Monitor className="mx-auto h-6 w-6" aria-hidden="true" />
      <p className="mt-2 text-sm">{label('empty')}</p>
    </div>}
    {nodes.length > 0 && <div className="mt-[22px]">
      <WsTable head={<><WsTh>{l('colDevice')}</WsTh><WsTh>{l('colSystem')}</WsTh><WsTh>{l('colStatus')}</WsTh><WsTh>{l('colLastOnline')}</WsTh></>}>
        {nodes.map(n => <tr key={n.nodeId} onClick={() => selectNode(n.nodeId)} className={cn('cursor-pointer transition-colors hover:bg-accent/40', selected === n.nodeId && 'bg-accent/40')}>
          <WsTd>{n.name}</WsTd>
          <WsTd className="text-muted-foreground">{n.platform ?? '—'}</WsTd>
          <WsTd><StatusPill><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{n.state === 'active' ? l('deviceOnline') : l('deviceOffline')}</StatusPill></WsTd>
          <WsTd className="text-muted-foreground">{date(n.lastReportAt)}</WsTd>
        </tr>)}
      </WsTable>
    </div>}
    {node && <section className="mt-[22px] min-w-0 space-y-3 break-words rounded-[9px] border bg-card p-4">
      <h2 className="text-[17px] font-semibold">{node.name}</h2>
      <p className="text-sm text-muted-foreground">{node.nodeId} · {node.state} · {node.platform} · {node.runtimeVersion}</p>
      <p className="text-sm">{label('lastReport')}: {date(node.lastReportAt)}</p>
      {node.state === 'revoked' && <><p className="text-sm">{label('revokedAt')}: {date(node.revokedAt)}</p><p role="status" className="text-sm">{label(node.deviceRevocation === 'confirmed' ? 'revocationConfirmed' : 'revocationPending')}</p></>}
      <h3 className="text-sm font-semibold">{label('capabilities')}</h3>
      <p className="text-sm text-muted-foreground">{label('grantHint')}</p>
      {[...new Set([...(node.capabilities?.map(c => c.name) ?? []), ...node.granted])].map(name => {
        const cap = node.capabilities?.find(c => c.name === name);
        const canAdd = known.has(name) && cap?.available === true;
        return <div key={name} className="rounded-[7px] border p-2">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={grants.includes(name)} disabled={busy || node.state !== 'active' || (!canAdd && !node.granted.includes(name))} onChange={e => setGrants(old => e.target.checked ? [...old, name] : old.filter(c => c !== name))}/><span>{name} · {cap?.version} · {label(cap?.available ? 'available' : 'unavailable')}</span></label>
          {cap?.reason && <p className="text-sm text-muted-foreground">{cap.reason}</p>}
          {!known.has(name) && <p className="text-sm text-muted-foreground">{label('unknownCapability')}</p>}
        </div>;
      })}
      {node.state === 'active' && <div className="flex flex-wrap gap-2">
        <Button disabled={busy || JSON.stringify([...grants].sort()) === JSON.stringify([...node.granted].sort())} onClick={() => {if (window.confirm(label('confirm'))) void act(async () => {const n = await api.grantNode(node.nodeId, grants); if (live.current) accept(n);});}}>{label('saveGrants')}</Button>
        <Button variant="destructive" disabled={busy} onClick={() => {if (window.confirm(label('revokeConfirm'))) void act(async () => {const n = await api.revokeNode(node.nodeId); if (live.current) accept(n);});}}>{label('revokeDevice')}</Button>
      </div>}
      <h3 className="text-sm font-semibold">{label('workdir')}</h3>
      {node.workdirs?.map(w => <p key={w.id} className="text-sm text-muted-foreground">{w.label} · {w.id}</p>)}
    </section>}
  </main>;
}
