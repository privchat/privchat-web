import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrivchatClient } from '@privchat/sdk';
import { Button } from '@/components/ui/button';
import type { TaskFeedPage, WorkItem, WorkspaceActivity, WorkspaceApi, TaskScope } from './api';
import { historical, mergeTaskFeed, mergeActivityPage, unfinishedTaskFeed, validateTaskFeed } from './task-feed';
import { usePageLabels } from './page-labels';
import { WorkspaceRoomObserver, roomFailure } from './room-observer';
import {taskStageLabel} from './task-stage';

export function TaskFeed({api, client, workspaceId, projectId, employeeId, unprojected, view = 'legacy', enabled = true, projects = [], onOpen}: TaskScope & {api: WorkspaceApi; client?: PrivchatClient; view?: 'legacy' | 'active' | 'history'; enabled?: boolean; projects?: import('./api').Project[]; onOpen: (row: WorkspaceActivity) => void}) {
  const activeOnly = view === 'active';
  const modern = view !== 'legacy';
  const loadedPages = useRef(1);

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
  const observer = useRef<WorkspaceRoomObserver | undefined>(undefined);
  const refreshQueued = useRef(false);
  const accessDenied = useRef(false);
  const initialized = useRef(false);
  const bottom = useRef(true);
  const anchor = useRef<{cards: {id: string; offset: number}[]; top: number} | undefined>(undefined);
  const follow = useRef(false);
  const olderCursor = useRef<string | null>(null);
  const currentRows = useRef(rows); currentRows.current = rows;
  const visibleRows = activeOnly ? unfinishedTaskFeed(rows) : rows;
  function remember() {
    const host = viewport.current;
    if (!host) return;
    const top = host.getBoundingClientRect().top;
    const cards = [...host.querySelectorAll<HTMLElement>('[data-item-id]')]
      .filter(el => el.getBoundingClientRect().bottom > top)
      .map(el => ({id: el.dataset.itemId!, offset: el.getBoundingClientRect().top - top}));
    anchor.current = {cards, top: host.scrollTop};
  }
  function apply(next: TaskFeedPage, older = false, replace = false) {
    remember();
    follow.current = !modern && !older && bottom.current;
    setRows(old => (modern ? mergeActivityPage : mergeTaskFeed)(replace ? [] : old, next.items));
    if (older || replace || modern || !initialized.current) {setPage(next); olderCursor.current = next.olderCursor;}
    initialized.current = true;
    setPending(undefined);
  }
  async function load(older = false, explicit = false, roomSnapshot = false): Promise<WorkItem[]> {
    if (accessDenied.current) return [];
    if (running.current) {if (roomSnapshot) refreshQueued.current = true; return [];}
    running.current = true; setBusy(true);
    try {
      let cursor = older ? olderCursor.current ?? undefined : undefined;
      let next!: TaskFeedPage;
      let items: WorkspaceActivity[] = [];
      const seen = new Set<string>();
      const count = modern && !older ? loadedPages.current : 1;
      for (let index = 0; index < count; index++) {
        if (cursor) {if (seen.has(cursor)) throw new Error('Repeated task cursor'); seen.add(cursor);}
        const result = modern
          ? await api.tasks(activeOnly ? 'active_tasks_v1' : 'history_tasks_v1', {workspaceId, projectId, employeeId, unprojected}, cursor)
          : await api.taskFeed(workspaceId!, projectId, cursor);
        next = validateTaskFeed(result, workspaceId, projectId, cursor, unprojected);
        items = mergeActivityPage(items, next.items);
        if (next.refreshRequired || !next.hasOlder) break;
        cursor = next.olderCursor!;
      }
      next = {...next, items};
      if (!live.current) return [];
      setError(false);
      if (next.refreshRequired) {setPending(next); return [];}
      if (!initialized.current || older || (!modern && bottom.current) || explicit) {if (older) loadedPages.current++; apply(next, older, modern && !older);}
      else if (modern ? JSON.stringify(currentRows.current) !== JSON.stringify(next.items) : next.items.some(row => JSON.stringify(currentRows.current.find(old => old.item.id === row.item.id)) !== JSON.stringify(row))) setPending(next);
      return next.items.map(row => row.item);
    } catch (e) {
      if (!live.current) return [];
      setError(true);
      if (roomFailure(e) === 'denied') {accessDenied.current = true; setDenied(true); setRows([]); setPending(undefined); setPage(undefined);}
      if (roomSnapshot) throw e;
      return [];
    } finally {
      running.current = false;
      if (live.current) {
        setBusy(false);
        if (refreshQueued.current) {refreshQueued.current = false; void observer.current?.refresh();}
      }
    }
  }
  useEffect(() => {
    if (!enabled) return;
    live.current = true;
    if (client && workspaceId) {
      const watch = new WorkspaceRoomObserver(workspaceId, client, () => api.join(workspaceId), () => load(false, false, true), state => {
        if (!live.current) return;
        if (state === 'denied') {accessDenied.current = true; setDenied(true); setRows([]); setPage(undefined); setPending(undefined);}
        if (state !== 'live') setError(true);
      });
      observer.current = watch;
      const off = client.observeEvents(({event}) => {
        if (event.type === 'channel_publish_received') watch.publish(event.channel_id, event.topic, event.payload_text);
        if (event.type === 'connection_state_changed') void watch.refresh(true);
      });
      const foreground = () => {if (document.visibilityState === 'visible') void watch.refresh(true);};
      void watch.refresh();
      const timer = setInterval(() => void watch.refresh(), 15000);
      document.addEventListener('visibilitychange', foreground);
      return () => {live.current = false; off(); clearInterval(timer); document.removeEventListener('visibilitychange', foreground); void watch.stop(); observer.current = undefined;};
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {live.current = false; clearInterval(timer);};
  }, [api, client, workspaceId, projectId, employeeId, unprojected, view, enabled]);
  useLayoutEffect(() => {
    const host = viewport.current;
    if (!host) return;
    if (follow.current) {host.scrollTop = host.scrollHeight; follow.current = false;}
    else if (anchor.current) {
      const saved = anchor.current;
      const elements = [...host.querySelectorAll<HTMLElement>('[data-item-id]')];
      const survivor = saved.cards.find(card => elements.some(el => el.dataset.itemId === card.id));
      const card = elements.find(el => el.dataset.itemId === survivor?.id);
      if (card && survivor) host.scrollTop += card.getBoundingClientRect().top - host.getBoundingClientRect().top - survivor.offset;
      else host.scrollTop = saved.top;
    }
    anchor.current = undefined;
  }, [rows]);
  return <section className="space-y-2" data-testid="task-feed">
    <div className="flex gap-2">
      <Button variant="outline" disabled={busy || denied} onClick={() => void load(false, true)}>{l('reload')}</Button>
      {pending && <Button disabled={busy} onClick={() => {
        if (pending.refreshRequired) {
          void load(false, true);
        } else apply(pending, false, modern);
      }}>{l('updates')}</Button>}
    </div>
    {error && <p role="alert">{denied ? l('accessDenied') : l('error')}</p>}
    <div ref={viewport} data-testid="task-feed-scroll" className="h-[58dvh] min-h-48 space-y-3 overflow-y-auto overscroll-contain [overflow-anchor:none]" onScroll={() => {
      const host = viewport.current!;
      bottom.current = host.scrollHeight - host.clientHeight - host.scrollTop < 48;
    }}>
      {!modern && page?.hasOlder && <Button disabled={busy || denied} onClick={() => void load(true)}>{l('older')}</Button>}
      {!visibleRows.length && <p role="status">{l(busy ? 'loading' : activeOnly ? 'activeEmpty' : 'empty')}</p>}
      {visibleRows.map((row, index) => <div key={row.item.id} data-item-id={row.item.id}>
        {!modern && (index === 0 || historical(visibleRows[index - 1]!) !== historical(row)) && <h3 className="py-2 text-sm text-muted-foreground">{l(historical(row) ? 'history' : 'unfinished')}</h3>}
        <article className="min-w-0 space-y-2 break-words rounded-lg border bg-card p-4" data-testid="task-card">
          <h4 className="break-words font-semibold">{modern ? <button type="button" className="text-left hover:underline focus-visible:underline" onClick={() => onOpen(row)}>{row.item.title}</button> : row.item.title}</h4>
          <p className="text-sm">{l('project')}: {row.item.projectId ? projects.find(project => project.id === row.item.projectId)?.name ?? row.item.projectId : l('ungrouped')}</p>
          {!modern && <><p>{l('status')}: {t(`agentWorkspace.status_${row.item.status}`, {defaultValue: row.item.status})}</p>
          <p className="text-sm">{l('execution')}: {row.latestExecution?.state ? t(`agentWorkspace.execution_${row.latestExecution.state}`, {defaultValue: row.latestExecution.state}) : l('none')}</p></>}
          {modern ? <>
            <p className="text-sm">{l('developer')}: {row.developerEmployeeId ?? l('unassigned')}</p>
            <p className="text-sm">{l('reviewer')}: {row.reviewerEmployeeId ?? l('unassigned')}{!row.reviewNoteId && row.reviewerEmployeeId && <span> · {l('pendingAssignment')}</span>}</p>
            <p className="text-sm">{l('stage')}: {taskStageLabel(row, key => t(key))}</p>
            {row.needsAttention && <p className="text-sm font-medium">{l('needsAttention')}</p>}
            {row.lastActivityAt != null && <p className="text-xs text-muted-foreground">{l('activity')}: {new Date(row.lastActivityAt).toLocaleString()}</p>}
          </> : row.latestExecution?.employeeId && <p>{l('employees')}: {row.latestExecution.employeeId}</p>}
          {!modern && historical(row) && <p className="text-xs text-muted-foreground">{row.item.closedAt ? new Date(row.item.closedAt).toLocaleString() : l('unknownTime')}</p>}
          {!modern && !historical(row) && <p className="text-sm text-muted-foreground">{l('noResult')}</p>}
          {!modern && <Button variant="outline" onClick={() => onOpen(row)}>{l('details')}</Button>}
        </article>
      </div>)}
      {modern && page?.hasOlder && <Button disabled={busy || denied} onClick={() => void load(true)}>{l('more')}</Button>}
    </div>
  </section>;
}
