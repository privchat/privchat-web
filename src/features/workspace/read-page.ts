import { useCallback, useEffect, useRef, useState } from 'react';
import { PlatformHttpError } from '../../lib/platform-errors';
import { roomFailure } from './room-observer';

export type ReadStatus = 'loading' | 'ready' | 'error' | 'unsupported' | 'denied';
export interface ReadPage<T> { items: T[]; nextCursor: string | null }

/** Read-only pagination: one request at a time, scoped responses, first occurrence wins on overlap. */
export function useReadPage<T, P extends ReadPage<T>>(load: (cursor?: string) => Promise<P>, key: (row: T) => string) {
  const [rows, setRows] = useState<T[]>([]);
  const [page, setPage] = useState<P>();
  const [status, setStatus] = useState<ReadStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [gap, setGap] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const stopped = useRef(false);
  const keyRef = useRef(key); keyRef.current = key;
  const read = useCallback(async (cursor?: string) => {
    if (running.current || stopped.current) return;
    running.current = true;
    const current = generation.current;
    setBusy(true);
    if (cursor === undefined) { setRows([]); setPage(undefined); setGap(false); setStatus('loading'); }
    try {
      const result = await load(cursor);
      if (current !== generation.current) return;
      if (result.nextCursor !== null && (!result.nextCursor || result.nextCursor === cursor)) throw new Error('Non-progressing page');
      setRows(old => {
        const merged = new Map((cursor === undefined ? [] : old).map(row => [keyRef.current(row), row]));
        for (const row of result.items) if (!merged.has(keyRef.current(row))) merged.set(keyRef.current(row), row);
        return [...merged.values()];
      });
      if ('snapshotRequired' in result && result.snapshotRequired === true) setGap(true);
      setPage(result); setStatus('ready');
    } catch (e) {
      if (current !== generation.current) return;
      const denied = roomFailure(e) === 'denied';
      setStatus(denied ? 'denied' : e instanceof PlatformHttpError && [404, 405, 501].includes(e.status) ? 'unsupported' : 'error');
      if (denied) { stopped.current = true; setRows([]); setPage(undefined); setGap(false); }
    } finally {
      if (current === generation.current) { running.current = false; setBusy(false); }
    }
  }, [load]);
  useEffect(() => {
    stopped.current = false; running.current = false;
    void read();
    return () => { generation.current++; stopped.current = true; };
  }, [read]);
  return {rows, page, status, busy, gap, refresh: () => read(), more: () => page?.nextCursor && read(page.nextCursor)};
}
