import type { Binding, Node, Project, ProjectBinding, WorkspaceEmployee } from './api';

/** Why an employee cannot work in this workspace now (MODULE_WORKSPACE_SPEC §18.8). */
export type UnavailableCause =
  | 'busy' | 'executorRestarting' | 'capabilityRevoked' | 'bindingMissing' | 'capabilityNotGranted'
  | 'nodeRevoked' | 'nodeOutdated' | 'directoryNotAllowed' | 'projectUnbound' | 'directoryMismatch'
  | 'notOwner' | 'otherMember' | 'accessUnavailable' | 'workspaceArchived' | 'offline' | 'unknownState' | 'other';

function grants(bindings: Binding[], nodeId?: string | null, capability?: string | null) {
  return !!nodeId && !!capability && bindings.some(b => b.revoked === 0 && b.nodeId === nodeId && b.capability === capability);
}

/**
 * module-agent answers a missing workspace binding and a capability the device never granted with the same code
 * (AGENT_CAPABILITY_NOT_GRANTED); the workspace's bindings and the device's grants tell them apart. `bindings`
 * undefined means not read yet, and then no binding is claimed missing.
 */
export function unavailableCause(reason: string | null | undefined, nodeId?: string | null, capability?: string | null,
  bindings?: Binding[], node?: Node): UnavailableCause {
  switch (reason?.toLowerCase()) {
    case 'agent_session_busy': case 'employee_busy': case 'busy': case 'session_busy': return 'busy';
    case 'agent_executor_restarting': case 'executor_restarting': return 'executorRestarting';
    case 'agent_capability_revoked': return 'capabilityRevoked';
    case 'agent_capability_not_granted':
      if (node && capability && !node.granted.includes(capability)) return 'capabilityNotGranted';
      if (bindings && nodeId && capability) return grants(bindings, nodeId, capability) ? 'capabilityNotGranted' : 'bindingMissing';
      return 'accessUnavailable';
    case 'agent_node_revoked': case 'agent_node_not_found': return 'nodeRevoked';
    case 'agent_protocol_unsupported': return 'nodeOutdated';
    case 'agent_workdir_not_allowed': return 'directoryNotAllowed';
    case 'project_binding_missing': return 'projectUnbound';
    case 'project_directory_mismatch': case 'workdir_mismatch': case 'directory_unavailable': return 'directoryMismatch';
    case 'permission_unavailable': case 'permission_denied': case 'agent_forbidden': case 'binding_revoked': return 'notOwner';
    case 'other_member': return 'otherMember';
    case 'workspace_archived': return 'workspaceArchived';
    case 'offline': case 'node_offline': case 'agent_node_offline': return 'offline';
    case 'availability_unknown': return 'unknownState';
    default: return 'other';
  }
}

export function employeeCause(row: WorkspaceEmployee, bindings?: Binding[], nodes?: Node[]): UnavailableCause | undefined {
  return row.available ? undefined : unavailableCause(row.unavailableReason, row.nodeId, row.capability, bindings, nodes?.find(n => n.nodeId === row.nodeId));
}

/** Another member's employee: named in their tasks, never offered for assignment (§20). */
export function otherMemberEmployee(row: WorkspaceEmployee) {
  return !row.available && row.unavailableReason?.toLowerCase() === 'other_member';
}

/**
 * The binding a link would need: the employee's own device, which only its owner (the caller) can grant.
 * Null when it already exists or the device is not the caller's active node.
 */
export function workspaceBindingGrant(nodeId: string | null | undefined, capability: string | null | undefined, bindings: Binding[], nodes: Node[]): {nodeId: string; capability: string} | null {
  if (!nodeId || !capability) return null;
  if (grants(bindings, nodeId, capability)) return null;
  if (!nodes.some(n => n.nodeId === nodeId && n.state === 'active')) return null;
  return {nodeId, capability};
}

/** The missing binding the viewer can grant from here: only for the device owner, and only for that cause. */
export function grantableWorkspaceBinding(row: WorkspaceEmployee, bindings: Binding[] | undefined, nodes: Node[]): {nodeId: string; capability: string} | null {
  if (employeeCause(row, bindings, nodes) !== 'bindingMissing') return null;
  const node = nodes.find(n => n.nodeId === row.nodeId && n.state === 'active');
  return node && row.capability ? {nodeId: node.nodeId, capability: row.capability} : null;
}

/** How choosing this executor on the node stands: already granted, granted by saving, or revoked by the owner. */
export function executorGrant(node: Node | undefined, executor: string): 'granted' | 'grantOnSave' | 'revoked' {
  const capability = `agent.${executor}`;
  if (!executor) return 'grantOnSave';
  if ((node?.granted ?? []).includes(capability)) return 'granted';
  if ((node?.revokedCapabilities ?? []).includes(capability)) return 'revoked';
  return 'grantOnSave';
}

/** The caller's binding of a project on one of their computers (at most one per computer, §20.3). */
export function myProjectBinding(project: Project | undefined, nodeId?: string | null): ProjectBinding | undefined {
  return project?.bindings.find(b => b.mine && !!nodeId && b.nodeId === nodeId);
}

export function myProjectBindings(project: Project | undefined): ProjectBinding[] {
  return (project?.bindings ?? []).filter(b => b.mine);
}

/** The default reviewer of the caller's own binding on that computer; never the developer itself. */
export function projectReviewer(project: Project | undefined, nodeId?: string | null): string | undefined {
  return myProjectBinding(project, nodeId)?.reviewerEmployeeId ?? undefined;
}

/** A start directory the caller bound as writable: the employee may develop there (§20.3). */
export function canDevelop(project: Project | undefined, nodeId?: string | null, workdirBindingId?: string | null) {
  if (workdirBindingId) return projectDirectory(project, nodeId, workdirBindingId)?.access === 'write';
  // This is an eligibility check only. The server resolves and freezes the directory.
  return writableProjectDirectories(project, nodeId).length === 1;
}

export function writableProjectDirectories(project: Project | undefined, nodeId?: string | null) {
  return myProjectBinding(project, nodeId)?.directories.filter(d => d.workdirBindingId && d.access === 'write') ?? [];
}

/** Any directory the caller bound there: the employee may review there, read-only included. */
export function canReview(project: Project | undefined, nodeId?: string | null, workdirBindingId?: string | null) {
  return workdirBindingId ? !!projectDirectory(project, nodeId, workdirBindingId)
    : !!myProjectBinding(project, nodeId)?.directories.some(d => d.workdirBindingId);
}

function reviewerAvailable(row: WorkspaceEmployee, project: Project, bindings?: Binding[], nodes?: Node[]) {
  return !otherMemberEmployee(row) && canReview(project, row.nodeId, row.workdirBindingId) &&
    (row.available || employeeCause(row, bindings, nodes) === 'directoryMismatch') &&
    grants(bindings ?? [], row.nodeId, row.capability);
}

export function defaultProjectReviewer(project: Project | undefined, developer: WorkspaceEmployee | undefined,
  employees: WorkspaceEmployee[], bindings?: Binding[], nodes?: Node[]) {
  if (!project || !developer?.nodeId) return;
  const id = projectReviewer(project, developer.nodeId);
  const directories = writableProjectDirectories(project, developer.nodeId);
  const directory = developer.workdirBindingId || (directories.length === 1 ? directories[0]?.workdirBindingId : undefined);
  return employees.find(row => row.employeeId === id && id !== developer.employeeId && row.nodeId === developer.nodeId &&
    (!row.workdirBindingId || row.workdirBindingId === directory) && reviewerAvailable(row, project, bindings, nodes));
}

export function projectDirectory(project: Project | undefined, nodeId?: string | null, workdirBindingId?: string | null) {
  return myProjectBinding(project, nodeId)?.directories.find(d => !!workdirBindingId && d.workdirBindingId === workdirBindingId);
}

/** The limits offered for automatic corrections; null uses the server default of one. */
export const CORRECTION_CHOICES: (number | null)[] = [null, 0, 3, 5, 10, 20, 50];
