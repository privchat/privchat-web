import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { TaskFeedPage, WorkspaceActivity, WorkspaceApi } from './api';
import { historical, mergeTaskFeed, validateTaskFeed } from './task-feed';
import { usePageLabels } from './page-labels';
import { roomFailure } from './room-observer';

export function TaskFeed({api, workspaceId, projectId, onOpen}: {api: WorkspaceApi; workspaceId: string; projectId?: string; onOpen: (row: WorkspaceActivity) => void}) {
  const l = usePageLabels();
  const {t} = useTranslation();
  const [rows, setRows] = useState<WorkspaceActivity[]>([]);
  const [page, setPage] = useState<TaskFeedPage>();
  const [pending, setPending] = useState<TaskFeedPage>();
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const live = useRef(false);
  const running = useRef(false);
  const initialized = useRef(false);
  const bottom = useRef(true);
  const anchor = useRef<{id: string; offset: number; top: number} | undefined>(undefined);
  const follow = useRef(false);
  const olderCursor = useRef<string | null>(null);
  const currentRows = useRef(rows); currentRows.current = rows;
  function remember() {
    const host = viewport.current;
    if (!host) return;
    const top = host.getBoundingClientRect().top;
    const card = [...host.querySelectorAll<HTMLElement>('[data-item-id]')].find(el => el.getBoundingClientRect().bottom > top);
    anchor.current = card ? {id: card.dataset.itemId!, offset: card.getBoundingClientRect().top - top, top: host.scrollTop} : undefined;
  }
  function apply(next: TaskFeedPage, older = false) {
    remember();
    follow.current = !older && bottom.current;
    setRows(old => mergeTaskFeed(old, next.items));
    if (older || !initialized.current) {setPage(next); olderCursor.current = next.olderCursor;}
    initialized.current = true;
    setPending(undefined);
  }
  async function load(older = false, explicit = false) {
    if (running.current || denied) return;
    running.current = true; setBusy(true);
    try {
      const next = validateTaskFeed(await api.taskFeed(workspaceId, projectId, older ? olderCursor.current ?? undefined : undefined), workspaceId, projectId);
      if (!live.current) return;
      setError(false);
      if (next.refreshRequired) {setPending(next); return;}
      if (!initialized.current || older || bottom.current || explicit) apply(next, older);
      else if (next.items.some(row => JSON.stringify(currentRows.current.find(old => old.item.id === row.item.id)) !== JSON.stringify(row))) setPending(next);
    } catch (e) {
      if (!live.current) return;
      setError(true);
      if (roomFailure(e) === 'denied') {setDenied(true); setRows([]); setPending(undefined); setPage(undefined);}
    } finally {running.current = false; if (live.current) setBusy(false);}
  }
  useEffect(() => {
    live.current = true;
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {live.current = false; clearInterval(timer);};
  }, [api, workspaceId, projectId]);
  useLayoutEffect(() => {
    const host = viewport.current;
    if (!host) return;
    if (follow.current) {host.scrollTop = host.scrollHeight; follow.current = false;}
    else if (anchor.current) {
      const saved = anchor.current;
      const card = [...host.querySelectorAll<HTMLElement>('[data-item-id]')].find(el => el.dataset.itemId === saved.id);
      if (card) host.scrollTop += card.getBoundingClientRect().top - host.getBoundingClientRect().top - saved.offset;
      else host.scrollTop = saved.top;
    }
    anchor.current = undefined;
  }, [rows]);
  return <section className="space-y-2" data-testid="task-feed">
    <div className="flex gap-2">
      <Button variant="outline" disabled={busy || denied} onClick={() => void load(false, true)}>{l('reload')}</Button>
      {pending && <Button disabled={busy} onClick={() => {
        if (pending.refreshRequired) {
          initialized.current = false; olderCursor.current = null; setRows([]); setPage(undefined); setPending(undefined); void load();
        } else apply(pending);
      }}>{l('updates')}</Button>}
    </div>
    {error && <p role="alert">{denied ? l('readOnly') : l('error')}</p>}
    <div ref={viewport} data-testid="task-feed-scroll" className="h-[58dvh] min-h-48 space-y-3 overflow-y-auto overscroll-contain [overflow-anchor:none]" onScroll={() => {
      const host = viewport.current!;
      bottom.current = host.scrollHeight - host.clientHeight - host.scrollTop < 48;
    }}>
      {page?.hasOlder && <Button disabled={busy || denied} onClick={() => void load(true)}>{l('older')}</Button>}
      {!rows.length && <p role="status">{l(busy ? 'loading' : 'empty')}</p>}
      {rows.map((row, index) => <div key={row.item.id} data-item-id={row.item.id}>
        {(index === 0 || historical(rows[index - 1]!) !== historical(row)) && <h3 className="py-2 text-sm text-muted-foreground">{l(historical(row) ? 'history' : 'unfinished')}</h3>}
        <article className="space-y-2 rounded-lg border bg-card p-4" data-testid="task-card">
          <h4 className="break-words font-semibold">{row.item.title}</h4>
          {row.item.projectId && <p className="text-sm">{l('project')}: {row.item.projectId}</p>}
          <p>{l('status')}: {t(`agentWorkspace.status_${row.item.status}`, {defaultValue: row.item.status})}</p>
          <p className="text-sm">{l('execution')}: {row.latestExecution?.state ? t(`agentWorkspace.execution_${row.latestExecution.state}`, {defaultValue: row.latestExecution.state}) : l('none')}</p>
          {row.latestExecution?.employeeId && <p>{l('employees')}: {row.latestExecution.employeeId}</p>}
          {historical(row) && <p className="text-xs text-muted-foreground">{row.item.closedAt ? new Date(row.item.closedAt).toLocaleString() : l('unknownTime')}</p>}
          {!historical(row) && <p className="text-sm text-muted-foreground">{l('noResult')}</p>}
          <Button variant="outline" onClick={() => onOpen(row)}>{l('details')}</Button>
        </article>
      </div>)}
    </div>
  </section>;
}
