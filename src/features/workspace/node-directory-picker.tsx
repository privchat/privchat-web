import {useEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {PlatformApiError} from '@/lib/platform-errors';
import type {WorkspaceApi} from './api';
import {usePageLabels} from './page-labels';

interface Entry {path: string; name: string}
interface Listing {path: string; entries: Entry[]; truncated?: boolean}
type Query = 'fs.roots' | 'fs.list' | 'project.add';
interface Reply<T> {kind: Query; outcome: string; data: T}

function directoryEntries(data: unknown): Entry[] {
  if (!Array.isArray(data) || data.length > 200) throw new Error('Invalid node directory entries');
  return data.filter((entry): entry is Entry => typeof entry?.path === 'string' &&
    entry.path.length > 0 && entry.path.length <= 1024 && typeof entry.name === 'string');
}

export function NodeDirectoryPicker({api, nodeId, disabled, onPicked}: {
  api: WorkspaceApi; nodeId: string; disabled?: boolean; onPicked: (dir: {id: string; label: string}) => void;
}) {
  const l = usePageLabels();
  const [roots, setRoots] = useState<Entry[]>();
  const [trail, setTrail] = useState<Listing[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<'offline' | 'unsupported' | 'error'>();
  const [reload, setReload] = useState(0);
  const epoch = useRef(0);
  const here = trail.at(-1);
  async function query<T>(kind: Query, params: {path?: string} = {}) {
    const reply = await api.post<Reply<T>>('/agent/nodes/query', {nodeId, kind, params});
    if (reply?.kind !== kind || reply.outcome !== 'ok' || !reply.data) throw new Error('Invalid node directory reply');
    return reply.data;
  }
  async function list(path: string): Promise<Listing> {
    const data = await query<Listing>('fs.list', {path});
    if (typeof data.path !== 'string' || !data.path) throw new Error('Invalid node directory path');
    return {...data, entries: directoryEntries(data.entries)};
  }
  async function task(run: (current: () => boolean) => Promise<void>) {
    const id = ++epoch.current;
    const current = () => id === epoch.current;
    setBusy(true); setError(undefined);
    try {await run(current);}
    catch (e) {
      if (current()) {
        const code = e instanceof PlatformApiError ? e.machineCode : undefined;
        setError(code === 'AGENT_NODE_OFFLINE' ? 'offline' :
          code === 'AGENT_OPERATION_UNSUPPORTED' || code === 'AGENT_PROTOCOL_UNSUPPORTED' ? 'unsupported' : 'error');
      }
    } finally {if (current()) setBusy(false);}
  }
  useEffect(() => {
    setRoots(undefined); setTrail([]);
    void task(async current => {
      const data = await query<{scopes: Entry[]}>('fs.roots');
      const scopes = directoryEntries(data.scopes);
      if (!current()) return;
      setRoots(scopes);
      if (scopes.some(entry => entry.path === '/')) {
        const listing = await list('/');
        if (current()) setTrail([listing]);
      }
    });
    return () => {epoch.current++;};
  }, [api, nodeId, reload]);

  function open(path: string) {
    if (busy || disabled) return;
    void task(async current => {
      const listing = await list(path);
      if (current()) setTrail(previous => [...previous, listing]);
    });
  }
  function choose(path: string) {
    if (busy || disabled) return;
    void task(async current => {
      const known = (await api.nodes()).find(node => node.nodeId === nodeId)?.workdirs?.find(dir => dir.id === path);
      if (!current()) return;
      if (known) {onPicked(known); return;}
      const {status, workdir} = await query<{status: string; workdir?: {id: string; label: string}}>('project.add', {path});
      if (status !== 'added' || !workdir?.id) throw new Error('Node did not register the selected directory');
      for (let attempt = 0; attempt < 12 && current(); attempt++) {
        const confirmed = (await api.nodes()).find(node => node.nodeId === nodeId)?.workdirs?.find(dir => dir.id === workdir.id);
        if (!current()) return;
        if (confirmed) {onPicked(confirmed); return;}
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      throw new Error('Node directory registration has not arrived');
    });
  }
  const entries = here?.entries ?? roots;
  return <div data-testid="node-directory-picker" className="space-y-2 rounded border p-2 text-sm" aria-busy={busy}>
    <p className="break-all font-medium">{here?.path ?? l('directoryRoots')}</p>
    {here && <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="ghost" disabled={busy || disabled} onClick={() => setTrail(t => t.slice(0, -1))}>{l('directoryUp')}</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || disabled} onClick={() => choose(here.path)}>{l('chooseDirectory')}</Button>
    </div>}
    {busy && <p role="status">{l('loading')}</p>}
    {error && <p role="status">{l(error === 'offline' ? 'reasonOffline' : error === 'unsupported' ? 'directoryBrowseUnsupported' : 'directoryBrowseError')}</p>}
    {!busy && error && <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setReload(v => v + 1)}>{l('retry')}</Button>}
    {!busy && !error && entries?.length === 0 && <p>{l('empty')}</p>}
    {!!entries?.length && <ul className="max-h-48 space-y-1 overflow-y-auto">
      {entries.map(entry => <li key={entry.path}><Button className="w-full justify-start" type="button" size="sm" variant="ghost" disabled={busy || disabled} onClick={() => open(entry.path)}>
        <span className="min-w-0 truncate">{entry.name || entry.path}</span>
      </Button></li>)}
    </ul>}
    {here?.truncated && <p className="text-muted-foreground">{l('directoryListTruncated')}</p>}
  </div>;
}
