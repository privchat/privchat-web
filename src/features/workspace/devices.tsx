import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type Node, type PairingView } from './api';
import { roomFailure } from './room-observer';

const known = new Set(['agent.codex', 'agent.claude', 'workspace_events_read']);
const field = 'block w-full min-w-0 rounded border bg-background px-3 py-2';

export function DevicePage({api, onBack}: {api: WorkspaceApi; onBack: () => void}) {
  const {t, i18n} = useTranslation();
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
  const node = nodes.find(n => n.nodeId === selected);
  const date = (value?: number | null) => value ? new Date(value).toLocaleString(i18n.resolvedLanguage) : label('empty');
  const accept = (n: Node) => {setNodes(old => old.map(x => x.nodeId === n.nodeId ? n : x)); setGrants(n.granted);};
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
  return <main data-testid="device-page" className="mx-auto w-full max-w-4xl min-w-0 space-y-5 overflow-y-auto p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-semibold">{label('deviceManagement')}</h1><Button variant="outline" disabled={busy} onClick={onBack}>{label('back')}</Button></div>
    {error && <p role="alert">{label(error)}</p>}
    {loading && <p role="status">{label('loading')}</p>}
    <Button variant="outline" disabled={busy || loading} onClick={() => void act(refresh)}>{label('refresh')}</Button>
    <form className="space-y-2 rounded border p-4" onSubmit={e => {e.preventDefault(); if (code.trim() && window.confirm(label('pairingConfirm'))) void act(async () => {
      const result = await api.approvePairing(code.trim());
      if (live.current) {setPairing(result); setCode('');}
      await refresh();
    });}}>
      <h2 className="font-semibold">{label('pairing')}</h2><p className="text-sm text-muted-foreground">{label('pairingHint')}</p>
      <label className="block">{label('pairingCode')}<input autoComplete="off" className={field} value={code} disabled={busy} onChange={e => {setCode(e.target.value); setPairing(undefined);}} /></label>
      <Button disabled={busy || !code.trim()}>{label('approvePairing')}</Button>
      {pairing && <div role="status" className="break-words"><p>{label('pairingApproved')}</p><p>{pairing.deviceName} · {pairing.platform} · {pairing.runtimeVersion}</p><p>{label('expiresAt')}: {date(pairing.expiresAt)}</p></div>}
    </form>
    {!loading && !nodes.length && <p>{label('empty')}</p>}
    <label className="block">{label('nodes')}<select className={field} value={selected} disabled={busy} onChange={e => {setSelected(e.target.value); setGrants(nodes.find(n => n.nodeId === e.target.value)?.granted ?? []);}}>
      <option value="">{label('nodes')}</option>{nodes.map(n => <option key={n.nodeId} value={n.nodeId}>{n.name} · {n.state} · {n.nodeId}</option>)}
    </select></label>
    {node && <section className="min-w-0 space-y-3 rounded border p-4 break-words">
      <h2 className="font-semibold">{node.name}</h2><p>{node.nodeId} · {node.state} · {node.platform} · {node.runtimeVersion}</p>
      <p>{label('lastReport')}: {date(node.lastReportAt)}</p>
      {node.state === 'revoked' && <><p>{label('revokedAt')}: {date(node.revokedAt)}</p><p role="status">{label(node.deviceRevocation === 'confirmed' ? 'revocationConfirmed' : 'revocationPending')}</p></>}
      <h3>{label('capabilities')}</h3><p className="text-sm">{label('grantHint')}</p>
      {[...new Set([...(node.capabilities?.map(c => c.name) ?? []), ...node.granted])].map(name => {
        const cap = node.capabilities?.find(c => c.name === name);
        const canAdd = known.has(name) && cap?.available === true;
        return <div key={name} className="rounded border p-2">
          <label className="flex items-start gap-2"><input type="checkbox" checked={grants.includes(name)} disabled={busy || node.state !== 'active' || (!canAdd && !node.granted.includes(name))} onChange={e => setGrants(old => e.target.checked ? [...old, name] : old.filter(c => c !== name))}/><span>{name} · {cap?.version} · {label(cap?.available ? 'available' : 'unavailable')}</span></label>
          {cap?.reason && <p className="text-sm">{cap.reason}</p>}
          {!known.has(name) && <p className="text-sm">{label('unknownCapability')}</p>}
        </div>;
      })}
      {node.state === 'active' && <div className="flex flex-wrap gap-2">
        <Button disabled={busy || JSON.stringify([...grants].sort()) === JSON.stringify([...node.granted].sort())} onClick={() => {if (window.confirm(label('confirm'))) void act(async () => {const n = await api.grantNode(node.nodeId, grants); if (live.current) accept(n);});}}>{label('saveGrants')}</Button>
        <Button variant="destructive" disabled={busy} onClick={() => {if (window.confirm(label('revokeConfirm'))) void act(async () => {const n = await api.revokeNode(node.nodeId); if (live.current) accept(n);});}}>{label('revokeDevice')}</Button>
      </div>}
      <h3>{label('workdir')}</h3>{node.workdirs?.map(w => <p key={w.id}>{w.label} · {w.id}</p>)}
    </section>}
  </main>;
}
