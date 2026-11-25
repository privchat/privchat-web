/** Hash routes for the workspace module (§18.11). The host owns `location.hash`;
 * every view is directly addressable so refresh, deep links and back/forward work. */
export type WorkspaceRoute =
  | {view: 'home'}
  | {view: 'resume'}
  | {view: 'projects'; workspaceId?: string}
  | {view: 'create-project'; workspaceId?: string}
  | {view: 'project'; projectId: string}
  | {view: 'devices'}
  | {view: 'create-space'}
  | {view: 'space'; spaceId: string}
  | {view: 'records'; spaceId: string}
  | {view: 'create-item'; spaceId: string; projectId?: string}
  | {view: 'item'; spaceId: string; itemId: string; executionId?: string}
  | {view: 'employees'; spaceId: string}
  | {view: 'employee'; spaceId: string; employeeId: string; panel?: 'profile' | 'rebind'}
  | {view: 'members'; spaceId: string}
  | {view: 'settings'; spaceId: string};

const ROOT = '/workspace';

export function isWorkspaceHash(hash: string) {
  return hash === `#${ROOT}` || hash.startsWith(`#${ROOT}/`) || hash.startsWith(`#${ROOT}?`);
}

/** Returns null when the hash belongs to another module; unknown workspace paths fall back home. */
export function parseWorkspaceRoute(hash: string): WorkspaceRoute | null {
  if (!isWorkspaceHash(hash)) return null;
  const [path = '', query = ''] = hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  let segments: string[];
  try {segments = path.split('/').filter(Boolean).slice(1).map(decodeURIComponent);} catch {return {view: 'home'};}
  const workspaceId = params.get('workspace') || undefined;
  if (segments.length === 0) return {view: 'home'};
  if (segments.length === 1 && segments[0] === 'tasks') return {view: 'resume'};
  if (segments[0] === 'projects') {
    if (segments.length === 1) return {view: 'projects', ...(workspaceId ? {workspaceId} : {})};
    if (segments.length === 2 && segments[1] === 'new') return {view: 'create-project', ...(workspaceId ? {workspaceId} : {})};
    if (segments.length === 2 && segments[1]) return {view: 'project', projectId: segments[1]};
    return {view: 'home'};
  }
  if (segments.length === 1 && segments[0] === 'devices') return {view: 'devices'};
  if (segments.length === 1 && segments[0] === 'new') return {view: 'create-space'};
  if (segments[0] === 'space' && segments.length >= 2 && segments[1]) {
    const spaceId = segments[1];
    if (segments.length === 2) return {view: 'space', spaceId};
    if (segments.length === 3 && segments[2] === 'records') return {view: 'records', spaceId};
    if (segments.length === 3 && segments[2] === 'new') {
      const projectId = params.get('project') || undefined;
      return {view: 'create-item', spaceId, ...(projectId ? {projectId} : {})};
    }
    if (segments.length === 3 && segments[2] === 'employees') return {view: 'employees', spaceId};
    if (segments.length === 3 && segments[2] === 'members') return {view: 'members', spaceId};
    if (segments.length === 3 && segments[2] === 'settings') return {view: 'settings', spaceId};
    if (segments.length === 4 && segments[2] === 'item' && segments[3]) {
      const executionId = params.get('execution') || undefined;
      return {view: 'item', spaceId, itemId: segments[3], ...(executionId ? {executionId} : {})};
    }
    if (segments.length === 4 && segments[2] === 'employee' && segments[3]) {
      const panel = params.get('panel');
      return {view: 'employee', spaceId, employeeId: segments[3], ...(panel === 'profile' || panel === 'rebind' ? {panel} : {})};
    }
  }
  return {view: 'home'};
}

export function workspaceHref(route: WorkspaceRoute): string {
  const query = new URLSearchParams();
  let path = ROOT;
  switch (route.view) {
    case 'home': break;
    case 'resume': path += '/tasks'; break;
    case 'projects': path += '/projects'; if (route.workspaceId) query.set('workspace', route.workspaceId); break;
    case 'create-project': path += '/projects/new'; if (route.workspaceId) query.set('workspace', route.workspaceId); break;
    case 'project': path += `/projects/${encodeURIComponent(route.projectId)}`; break;
    case 'devices': path += '/devices'; break;
    case 'create-space': path += '/new'; break;
    case 'space': path += `/space/${encodeURIComponent(route.spaceId)}`; break;
    case 'records': path += `/space/${encodeURIComponent(route.spaceId)}/records`; break;
    case 'create-item': path += `/space/${encodeURIComponent(route.spaceId)}/new`; if (route.projectId) query.set('project', route.projectId); break;
    case 'item':
      path += `/space/${encodeURIComponent(route.spaceId)}/item/${encodeURIComponent(route.itemId)}`;
      if (route.executionId) query.set('execution', route.executionId);
      break;
    case 'employees': path += `/space/${encodeURIComponent(route.spaceId)}/employees`; break;
    case 'employee':
      path += `/space/${encodeURIComponent(route.spaceId)}/employee/${encodeURIComponent(route.employeeId)}`;
      if (route.panel) query.set('panel', route.panel);
      break;
    case 'members':
    case 'settings': path += `/space/${encodeURIComponent(route.spaceId)}/${route.view}`; break;
  }
  const suffix = query.toString();
  return `#${path}${suffix ? `?${suffix}` : ''}`;
}

export function navigateWorkspace(route: WorkspaceRoute) {
  location.hash = workspaceHref(route).slice(1);
}

/** Routes carrying account-scoped identities; an account switch must not reuse them. */
export function scopedWorkspaceRoute(route: WorkspaceRoute) {
  return route.view === 'create-project' || 'spaceId' in route || 'projectId' in route;
}
