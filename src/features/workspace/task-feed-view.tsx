import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Circle, Clock, RotateCw } from 'lucide-react';
import type { PrivchatClient } from '@privchat/sdk';
import { Button } from '@/components/ui/button';
import type { TaskFeedPage, WorkItem, WorkspaceActivity, WorkspaceApi, TaskScope } from './api';
import { mergeActivityPage, unfinishedTaskFeed, validateTaskFeed } from './task-feed';
import { usePageLabels } from './page-labels';
import { WorkspaceRoomObserver, roomFailure } from './room-observer';
import {taskStageLabel, taskStatusCategory, type TaskStatusCategory} from './task-stage';
import { StatusPill, WsTable, WsTd, WsTh } from './shell';

const CATEGORY_ICON = {pending: Circle, running: RotateCw, review: Clock, done: Check} as const;

function scrollHost(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll') return node;
    node = node.parentElement;
  }
  return el;
}

function relativeTime(value: number, language: string): string {
  const diff = value - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(language, {numeric: 'auto'});
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 7 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return new Date(value).toLocaleDateString(language);
}

export function TaskFeed({api, client, workspaceId, projectId, employeeId, unprojected, view, enabled = true, projects = [], onOpen, statusFilter = 'all', search = ''}: TaskScope & {api: WorkspaceApi; client?: PrivchatClient; view: 'active' | 'history'; enabled?: boolean; projects?: import('./api').Project[]; onOpen: (row: WorkspaceActivity) => void; statusFilter?: TaskStatusCategory | 'all'; search?: string}) {
  const activeOnly = view === 'active';
  const loadedPages = useRef(1);

  const l = usePageLabels();
  const {t, i18n} = useTranslation();
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
  const anchor = useRef<{cards: {id: string; offset: number}[]; top: number} | undefined>(undefined);
  const olderCursor = useRef<string | null>(null);
  const currentRows = useRef(rows); currentRows.current = rows;
  const base = activeOnly ? unfinishedTaskFeed(rows) : rows;
  const query = search.trim().toLowerCase();
  const visibleRows = base.filter(row =>
    (statusFilter === 'all' || taskStatusCategory(row) === statusFilter) &&
    (!query || row.item.title.toLowerCase().includes(query)));
  function remember() {
    const host = viewport.current;
    if (!host) return;
    const top = host.getBoundingClientRect().top;
    const cards = [...host.querySelectorAll<HTMLElement>('[data-item-id]')]
      .filter(el => el.getBoundingClientRect().bottom > top)
      .map(el => ({id: el.dataset.itemId!, offset: el.getBoundingClientRect().top - top}));
    anchor.current = {cards, top: scrollHost(host).scrollTop};
  }
  function apply(next: TaskFeedPage, older = false, replace = false) {
    remember();
    setRows(old => mergeActivityPage(replace ? [] : old, next.items));
    setPage(next); olderCursor.current = next.olderCursor;
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
      const count = older ? 1 : loadedPages.current;
      for (let index = 0; index < count; index++) {
        if (cursor) {if (seen.has(cursor)) throw new Error('Repeated task cursor'); seen.add(cursor);}
        const result = await api.tasks(activeOnly ? 'active_tasks_v1' : 'history_tasks_v1', {workspaceId, projectId, employeeId, unprojected}, cursor);
        next = validateTaskFeed(result, workspaceId, projectId, cursor, unprojected);
        items = mergeActivityPage(items, next.items);
        if (next.refreshRequired || !next.hasOlder) break;
        cursor = next.olderCursor!;
      }
      next = {...next, items};
      if (!live.current) return [];
      setError(false);
      if (next.refreshRequired) {setPending(next); return [];}
      if (!initialized.current || older || explicit) {if (older) loadedPages.current++; apply(next, older, !older);}
      else if (JSON.stringify(currentRows.current) !== JSON.stringify(next.items)) setPending(next);
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
    if (anchor.current) {
      const saved = anchor.current;
      const scroller = scrollHost(host);
      const elements = [...host.querySelectorAll<HTMLElement>('[data-item-id]')];
      const survivor = saved.cards.find(card => elements.some(el => el.dataset.itemId === card.id));
      const card = elements.find(el => el.dataset.itemId === survivor?.id);
      if (card && survivor) scroller.scrollTop += card.getBoundingClientRect().top - host.getBoundingClientRect().top - survivor.offset;
      else scroller.scrollTop = saved.top;
    }
    anchor.current = undefined;
  }, [rows]);
  return <section className="relative space-y-3" data-testid="task-feed">
    {(error || pending) && <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 space-y-1 rounded-md border bg-background/95 px-3 py-2 shadow-md">
      <div className="flex gap-2">
        {error && <Button variant="outline" size="sm" disabled={busy || denied} onClick={() => void load(false, true)}>{l('reload')}</Button>}
        {pending && <Button size="sm" disabled={busy} onClick={() => {
          if (pending.refreshRequired) {
            void load(false, true);
          } else apply(pending, false, true);
        }}>{l('updates')}</Button>}
      </div>
      {error && <p role="alert" className="text-sm">{denied ? l('accessDenied') : l('error')}</p>}
    </div>}
    <div ref={viewport} data-testid="task-feed-scroll">
      {!visibleRows.length && <p role="status" className="py-6 text-sm text-muted-foreground">{l(busy ? 'loading' : activeOnly ? 'activeEmpty' : 'empty')}</p>}
      {visibleRows.length > 0 && <WsTable head={<>
        <WsTh>{l('colTask')}</WsTh><WsTh>{l('project')}</WsTh><WsTh>{l('colEmployee')}</WsTh><WsTh>{l('colStatus')}</WsTh><WsTh>{l('colUpdated')}</WsTh>
      </>}>
        {visibleRows.map(row => {
          const category = taskStatusCategory(row);
          const Icon = CATEGORY_ICON[category];
          return <tr key={row.item.id} data-item-id={row.item.id} data-testid="task-card" className="hover:bg-accent/40">
            <WsTd className="max-w-0">
              <button type="button" className="break-words text-left font-semibold hover:underline focus-visible:underline" onClick={() => onOpen(row)}>{row.item.title}</button>
              <span className="ml-2 font-mono text-xs text-muted-foreground">{row.item.id.slice(0, 8)}</span>
              {row.needsAttention && <span className="ml-2 text-xs font-medium">{l('needsAttention')}</span>}
            </WsTd>
            <WsTd className="text-muted-foreground">{row.item.projectId ? projects.find(project => project.id === row.item.projectId)?.name ?? row.item.projectId : l('ungrouped')}</WsTd>
            <WsTd className="text-muted-foreground">{row.developerEmployeeId ?? row.reviewerEmployeeId ?? l('unassigned')}</WsTd>
            <WsTd><span className="sr-only">{l('stage')}: </span><StatusPill icon={Icon}>{taskStageLabel(row, key => t(key))}</StatusPill></WsTd>
            <WsTd className="whitespace-nowrap text-muted-foreground">{row.lastActivityAt != null ? relativeTime(row.lastActivityAt, i18n.resolvedLanguage ?? 'en') : '—'}</WsTd>
          </tr>;
        })}
      </WsTable>}
      {page?.hasOlder && <div className="pt-3"><Button variant="outline" size="sm" disabled={busy || denied} onClick={() => void load(true)}>{l('more')}</Button></div>}
    </div>
  </section>;
}
