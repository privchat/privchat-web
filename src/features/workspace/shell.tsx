import { useEffect, useState, type ReactNode } from 'react';
import { Bot, CheckSquare, ChevronDown, ChevronRight, Folder, Monitor, Plus, Users, type LucideIcon } from 'lucide-react';
import { brandConfig } from '@/lib/brand-config';
import { cn } from '@/lib/utils';
import type { Workspace, WorkspaceApi } from './api';
import { usePageLabels } from './page-labels';
import { navigateWorkspace, type WorkspaceRoute } from './routes';

export const wsField = 'block w-full min-w-0 rounded-[7px] border bg-background px-2.5 py-2 text-sm';

/** Monochrome status pill (design mockups): bordered, icon + label, no color. */
export function StatusPill({icon: Icon, children}: {icon?: LucideIcon; children: ReactNode}) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs">{Icon && <Icon className="h-3 w-3" />}{children}</span>;
}

/** Big title + gray subtitle on the left, white primary actions on the right. */
export function WsPageHeader({title, subtitle, actions}: {title: ReactNode; subtitle?: ReactNode; actions?: ReactNode}) {
  return <div className="mb-[23px] flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.035em]">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
  </div>;
}

export function WsTable({head, children}: {head: ReactNode; children: ReactNode}) {
  return <div className="relative overflow-x-auto rounded-[9px] border">
    <table className="w-full border-collapse text-left text-sm">
      <thead><tr className="bg-sidebar text-xs text-muted-foreground">{head}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}
export function WsTh({children, className}: {children?: ReactNode; className?: string}) {
  return <th className={cn('px-[15px] py-[13px] font-medium', className)}>{children}</th>;
}
export function WsTd({children, className}: {children?: ReactNode; className?: string}) {
  return <td className={cn('border-t px-[15px] py-[13px] align-middle first:font-medium', className)}>{children}</td>;
}

/** Segmented filter chip (design mockups tabs). */
export function WsChip({active, onClick, children}: {active: boolean; onClick: () => void; children: ReactNode}) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn('rounded-md px-[9px] py-1 text-sm transition-colors', active ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{children}</button>;
}
export function WsChipGroup({children, label}: {children: ReactNode; label?: string}) {
  return <div role="group" aria-label={label} className="inline-flex flex-wrap items-center gap-[3px] rounded-lg bg-accent p-[3px]">{children}</div>;
}

function routeSpaceId(route: WorkspaceRoute): string | undefined {
  if ('spaceId' in route) return route.spaceId;
  if ('workspaceId' in route) return route.workspaceId;
  return undefined;
}

type NavKey = 'navTasks' | 'navProjects' | 'navMembers' | 'navDevices' | 'navEmployees';
const NAV: {group: 'groupWorkspace' | 'groupResources'; items: {key: NavKey; icon: LucideIcon; views: WorkspaceRoute['view'][]; go: (spaceId?: string) => WorkspaceRoute}[]}[] = [
  {group: 'groupWorkspace', items: [
    {key: 'navTasks', icon: CheckSquare, views: ['space', 'records', 'create-item', 'item'], go: sid => sid ? {view: 'space', spaceId: sid} : {view: 'home'}},
    {key: 'navProjects', icon: Folder, views: ['projects', 'create-project', 'project'], go: sid => ({view: 'projects', workspaceId: sid})},
    {key: 'navMembers', icon: Users, views: ['settings'], go: sid => sid ? {view: 'settings', spaceId: sid} : {view: 'home'}},
  ]},
  {group: 'groupResources', items: [
    {key: 'navDevices', icon: Monitor, views: ['devices'], go: () => ({view: 'devices'})},
    {key: 'navEmployees', icon: Bot, views: ['employees'], go: sid => sid ? {view: 'employees', spaceId: sid} : {view: 'home'}},
  ]},
];

function sectionKey(route: WorkspaceRoute): NavKey | 'createSpace' | null {
  switch (route.view) {
    case 'space': case 'records': case 'create-item': case 'item': return 'navTasks';
    case 'projects': case 'create-project': case 'project': return 'navProjects';
    case 'employees': return 'navEmployees';
    case 'settings': return 'navMembers';
    case 'devices': return 'navDevices';
    case 'create-space': return 'createSpace';
    default: return null;
  }
}

/** Sidebar + breadcrumb chrome around the routed workspace view (design mockups).
 *  Purely presentational navigation: every target is an existing hash route, so
 *  deep links, refresh and back/forward keep working unchanged. */
export function WorkspaceShell({api, route, children}: {api: WorkspaceApi; route: WorkspaceRoute; children: ReactNode}) {
  const l = usePageLabels();
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  useEffect(() => {
    let live = true;
    void api.list().then(rows => {if (live) setSpaces(rows);}).catch(() => {});
    return () => {live = false;};
  }, [api]);
  const spaceId = routeSpaceId(route) ?? spaces[0]?.id;
  const space = spaces.find(s => s.id === spaceId);
  const section = sectionKey(route);
  const detail = route.view === 'item' || route.view === 'project';
  const initial = (brandConfig.appName || 'W').charAt(0).toUpperCase();
  return <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground md:flex-row">
    <aside className="flex min-w-0 shrink-0 flex-col border-b bg-sidebar px-3 pt-2 md:w-[224px] md:border-b-0 md:border-r md:py-3.5">
      <div className="hidden items-center gap-2.5 px-1.5 pb-[17px] pt-[3px] md:flex">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">{initial}</span>
        <span className="truncate text-[17px] font-bold">{brandConfig.appName}</span>
      </div>
      <div className="mb-1 flex items-center gap-1 md:mb-[17px]">
        <div className="flex min-w-0 flex-1 items-center rounded-[7px] border bg-background px-2">
          <select aria-label={l('shellSelectSpace')} className="w-full appearance-none bg-transparent py-2 text-sm outline-none" value={spaceId ?? ''} onChange={e => {if (e.target.value) navigateWorkspace({view: 'space', spaceId: e.target.value});}}>
            {!spaces.length && <option value="">{l('shellSelectSpace')}</option>}
            {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
        <button type="button" title={l('createSpace')} aria-label={l('createSpace')} data-testid="ws-create-space" className="rounded-[7px] border bg-background p-2 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => navigateWorkspace({view: 'create-space'})}><Plus className="h-4 w-4" /></button>
      </div>
      <nav className="flex min-h-0 flex-1 gap-1 overflow-x-auto md:block md:overflow-y-auto">
        {NAV.map(group => <div key={group.group} className="shrink-0">
          <p className="hidden px-2.5 pb-1 pt-2 text-[11px] text-muted-foreground md:block">{l(group.group)}</p>
          <div className="flex md:block">
            {group.items.map(item => {
              const active = item.views.includes(route.view);
              return <button key={item.key} type="button" data-testid={`ws-nav-${item.key}`} aria-current={active ? 'page' : undefined} onClick={() => navigateWorkspace(item.go(spaceId))} className={cn('my-0.5 flex w-full items-center justify-start gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-[7px] text-sm transition-colors md:gap-2.5 md:px-2.5', active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
                <item.icon className="h-4 w-4 shrink-0" />{l(item.key)}
              </button>;
            })}
          </div>
        </div>)}
      </nav>
    </aside>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center border-b px-4 md:h-[58px] md:px-[26px]">
        <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <button type="button" className="truncate hover:text-foreground" onClick={() => navigateWorkspace({view: 'home'})}>{space?.name ?? l('groupWorkspace')}</button>
          {section && <><ChevronRight className="h-3.5 w-3.5 shrink-0" /><span className="truncate text-foreground">{l(section)}</span></>}
          {detail && <><ChevronRight className="h-3.5 w-3.5 shrink-0" /><span className="truncate text-foreground">{l('shellDetail')}</span></>}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-4 py-5 md:px-8 md:py-[34px]">{children}</div>
      </div>
    </div>
  </div>;
}
