import { deleteAuthedEnvelope, getEnvelope, postAuthedEnvelope, putEnvelope, requireData } from '@/lib/platform-envelope';
import { getActiveAccessToken } from '@/lib/active-access-token';
import { getPlatformBaseUrl } from '@/lib/account-mode';
import { normalizePlatformBaseUrl } from '@/lib/platform-base-url';
import { PlatformApiError } from '@/lib/platform-errors';
import { isSessionExpiredError } from '@/lib/platform-error-message';
import { refreshActivePlatformToken } from '@/lib/auth-refresh-provider';

export interface Workspace { id: string; name: string; description: string; archived: number; myRole: string }
export interface WorkItem { id: string; workspaceId: string; title: string; description: string; acceptance?: string; projectId?: string | null; status: string; version: number; createdAt?: number; closedAt?: number | null }
export interface WorkNote { id: string; workItemId: string; kind: string; body: string; artifactRef?: string | null }
export interface Binding { id: string; nodeId: string; capability: string; revoked: number }
export interface Execution { executionId: string; nodeId: string; state: string; stateVersion: number; result?: unknown; capability?: string; scope?: {kind: string; ref: string}; nativeSessionId?: string | null; agentId?: string | null; params?: Record<string, unknown>; updatedAt?: number; createdAt?: number }
export interface WorkExecution { id: string; executionId: string | null; state: string | null; employeeId?: string | null; workItemVersion?: number | null; deliveryBlockedReason?: string | null }
export interface WorkReview { noteId: string; workItemId: string; workItemVersion: number; sourceWorkExecutionId: string; sourceExecutionId: string; evidenceNoteIds: string[]; evidenceDescription: string; reviewerEmployeeId: string; reviewerExecution: WorkExecution; requestedBy: string; createdAt: number; conclusion?: string | null; conclusionNoteId?: string | null; conclusionBody?: string | null; conclusionSource?: string | null }
export interface Node { nodeId: string; name: string; state: string; platform?: string; runtimeVersion?: string; lastReportAt?: number | null; revokedAt?: number | null; deviceRevocation?: string | null; granted: string[]; capabilities?: {name: string; available: boolean; version?: string; reason?: string | null}[]; workdirs?: {id: string; label: string}[]; sessionDiscovery?: {external: boolean; reason: string} }
export interface PairingView { pairingId: string; deviceName: string; platform: string; runtimeVersion: string; expiresAt: number }
export interface Employee { agentId: string; name: string; executor: string; config: Record<string, unknown>; createdAt: number; nodeId?: string; roleDescription: string; title: string; model: string; workdirBindingId: string; executionId?: string }
export interface EmployeeConfig { name: string; executor: string; nodeId: string; roleDescription: string; title: string; model: string; workdirBindingId: string; bindExecutionId?: string }
export type EmployeeCreateRequest = EmployeeConfig & {requestId: string};
export type EmployeeUpdateRequest = EmployeeConfig & {requestId: string; agentId: string};
export interface EmployeeSendRequest { agentId: string; requestId: string; text: string }
export interface RoomTicket { channelId: string; channelType: number; ticket: string; expiresAt: number; eventProtocolVersion: number }
export interface Command { commandId: string; executionId: string; kind: string; status: 'pending' | 'applied' | 'rejected' | 'unknown'; result?: { data?: Record<string, unknown>; error?: unknown } }
export interface Permission { permissionId: string; requestDigest: string; summary: string; expiresAt: number; status: string }
export interface NodeEvent { seq: number; kind: string; payload: Record<string, unknown> }
export interface ArchivedNodeEvent extends NodeEvent { protocolVersion: 1; executionId: string; eventId: string }
export interface WorkspaceActivity { item: WorkItem; latestExecution: WorkExecution | null; executionCount: number; developerEmployeeId?: string | null; reviewerEmployeeId?: string | null; stage?: string | null; lastActivityAt?: number | null; needsAttention?: boolean; reviewNoteId?: string | null }
export interface TaskScope { workspaceId?: string; projectId?: string; employeeId?: string; unprojected?: boolean }
export interface Page<T> { list: T[]; total: number }
export interface WorkspaceInboxEntry {
  /** `kind:id:version`; the same waiting fact keeps its key, a newer version is a new entry. */
  key: string; kind: 'decision' | 'review_cycle' | 'approval' | 'failure'; workspaceId: string; workItemId: string; workItemTitle: string;
  summary: string; createdAt: number; actionable: boolean;
  decisionId?: string | null; workExecutionId?: string | null; executionId?: string | null;
  permissionId?: string | null; requestDigest?: string | null; expiresAt?: number | null; state?: string | null; employeeId?: string | null;
  options: {id: string; label: string; description: string}[]; recommendedOptionId?: string | null;
}
export interface WorkspaceSummary extends Workspace { employeeCount: number; availableEmployeeCount?: number | null; employeeAvailabilityKnown?: boolean; openItemCount: number; lastActivityAt: number | null }
/** What the server accepts for a project's round-end rules. */
export const ROUND_END_LIMIT = 1000;
export const BINDING_NOTES_LIMIT = 2000;
export const BINDING_DIRECTORY_LIMIT = 16;
export type DirectoryAccess = 'write' | 'read';
/** One directory of a binding being saved: a directory the node authorized, `write` or `read` (§20.3). */
export interface ProjectBindingDirectoryWrite { workdirBindingId: string; access: DirectoryAccess }
/** The caller's binding of a project on one of their nodes; version is required to change an existing one. */
export interface ProjectBindingSave { projectId: string; nodeId: string; directories: ProjectBindingDirectoryWrite[]; notes?: string; reviewerEmployeeId?: string | null; version?: number }
/** Another member's binding shows only node name and directory labels, never ids, paths or notes (§20.3). */
export interface ProjectBinding {
  id: string; projectId: string; userId: string; mine: boolean;
  nodeId?: string | null; nodeName: string;
  directories: {workdirBindingId?: string | null; label: string; access: DirectoryAccess}[];
  notes?: string | null; reviewerEmployeeId?: string | null; version: number;
}
/** A workspace project; the workspace's owner and admins manage it (§20.2). */
export interface Project {
  id: string; workspaceId: string; name: string; archived: number; version: number;
  createdAt?: number; updatedAt?: number; createdBy?: string; description: string;
  manageable: boolean;
  /** The project's own round-end rules; blank means the platform default (§19.7). */
  roundEnd: string;
  bindings: ProjectBinding[];
}
export interface Member { id: string; workspaceId: string; userId: string; role: string; createdAt?: number }
export interface WorkspaceEmployee { id: string; workspaceId: string; employeeId: string; name?: string | null; nodeId?: string | null; capability?: string | null; workdirBindingId?: string | null; available: boolean; unavailableReason?: string | null; projectIds: string[]; previousResultUnknown?: boolean }
export interface WorkspaceEmployeePage { items: WorkspaceEmployee[]; nextCursor: string | null; hasMore: boolean }
export interface TaskFeedPage { items: WorkspaceActivity[]; olderCursor: string | null; hasOlder: boolean; refreshRequired: boolean }
export interface SessionRecordsPage {
  items: ArchivedNodeEvent[]; nextCursor: string | null; snapshotRequired: boolean;
  lastArchivedSeq: number; coverage: 'normalized_events_only';
}
/** §19.6: with autoReview, how many corrections the cycle may ask for. null: until the goal is met; 0: one review, no corrections. */
export interface WorkAssignRequest { workItemId: string; version: number; bindingId: string; employeeId: string; requestId: string; text: string; autoReview?: boolean; correctionLimit?: number | null; acknowledgeUnknown?: 'inspect' | 'rerun' }

/** Platform HTTP only. Node credentials are never used by the user console. */
export class WorkspaceApi {
  readonly base: string;
  constructor(base = getPlatformBaseUrl() ?? '', private token = getActiveAccessToken) {
    this.base = normalizePlatformBaseUrl(base);
  }
  private access(): string {
    const token = this.token();
    if (!token) throw new PlatformApiError(401, 'NOT_AUTHENTICATED');
    return token;
  }
  /** Run an authed request; on an auth rejection (access token expired
   *  after its 1h TTL) refresh once — single-flight across concurrent
   *  401s — and retry with the new token. The SDK-driven refresh only
   *  fires on SDK RPC failures, so without this the workspace HTTP path
   *  stays permanently 401 while the SDK is idle. A terminal refresh
   *  failure surfaces the original auth error. */
  private async authed<T>(run: (token: string) => Promise<T>): Promise<T> {
    const token = this.access();
    try {
      return await run(token);
    } catch (err) {
      if (!isSessionExpiredError(err)) throw err;
      let fresh: string;
      try {
        fresh = await refreshActivePlatformToken();
      } catch {
        throw err;
      }
      return await run(fresh);
    }
  }
  async get<T>(path: string): Promise<T> {
    return this.authed(async (token) => requireData(await getEnvelope<T>(`${this.base}${path}`, token), path));
  }
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.authed(async (token) => requireData(await postAuthedEnvelope<T>(`${this.base}${path}`, token, body), path));
  }
  async put<T>(path: string, body: unknown): Promise<T> {
    return this.authed(async (token) => requireData(await putEnvelope<T>(`${this.base}${path}`, token, body), path));
  }
  grantNode(nodeId: string, capabilities: string[]) { return this.post<Node>('/agent/nodes/grant', {nodeId, capabilities}); }
  revokeNode(nodeId: string) { return this.post<Node>('/agent/nodes/revoke', {nodeId}); }
  approvePairing(pairingCode: string) { return this.post<PairingView>('/agent/pairing/approve', {pairingCode}); }
  list() { return this.get<Workspace[]>('/workspace/list'); }
  space(id: string) { return this.get<Workspace>(`/workspace/get/${encodeURIComponent(id)}`); }
  spaces(pageNo = 1) { return this.get<Page<WorkspaceSummary>>(`/workspace/page?pageNo=${pageNo}&pageSize=20`); }
  members(workspaceId: string) { return this.get<Member[]>(`/workspace/member/list?workspaceId=${encodeURIComponent(workspaceId)}`); }
  addMember(workspaceId: string, userId: string, role: string) { return this.post<Member>('/workspace/member/create', {workspaceId, userId, role}); }
  updateMemberRole(id: string, role: string) { return this.put<Member>('/workspace/member/update-role', {id, role}); }
  async removeMember(id: string) { await this.authed((token) => deleteAuthedEnvelope<unknown>(`${this.base}/workspace/member/delete/${encodeURIComponent(id)}`, token)); }
  projects(workspaceId: string) { return this.get<Project[]>(`/workspace/project/list?workspaceId=${encodeURIComponent(workspaceId)}`); }
  projectPage(pageNo = 1, workspaceId?: string) { return this.get<Page<Project>>(`/workspace/project/page?pageNo=${pageNo}&pageSize=20${workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ''}`); }
  project(id: string) { return this.get<Project>(`/workspace/project/get/${encodeURIComponent(id)}`); }
  createProject(body: {workspaceId: string; name: string; description?: string; roundEnd?: string}) {
    return this.post<Project>('/workspace/project/create', {workspaceId: body.workspaceId, name: body.name, description: body.description ?? '', roundEnd: (body.roundEnd ?? '').trim().slice(0, ROUND_END_LIMIT)});
  }
  updateProject(body: {id: string; name: string; version: number; description?: string; roundEnd?: string}) {
    return this.put<Project>('/workspace/project/update', {id: body.id, name: body.name, version: body.version,
      ...(body.description === undefined ? {} : {description: body.description}),
      ...(body.roundEnd === undefined ? {} : {roundEnd: body.roundEnd.trim().slice(0, ROUND_END_LIMIT)})});
  }
  projectStatus(id: string, archived: number, version?: number) { return this.put<Project>('/workspace/project/update-status', {id, archived, ...(version === undefined ? {} : {version})}); }
  saveProjectBinding(body: ProjectBindingSave) {
    return this.post<ProjectBinding>('/workspace/project/binding/save', {projectId: body.projectId, nodeId: body.nodeId,
      directories: body.directories.map(({workdirBindingId, access}) => ({workdirBindingId, access})),
      notes: (body.notes ?? '').slice(0, BINDING_NOTES_LIMIT),
      ...(body.reviewerEmployeeId ? {reviewerEmployeeId: body.reviewerEmployeeId} : {}),
      ...(body.version === undefined ? {} : {version: body.version})});
  }
  async deleteProjectBinding(id: string) { await this.authed((token) => deleteAuthedEnvelope<unknown>(`${this.base}/workspace/project/binding/delete?${new URLSearchParams({id})}`, token)); }
  workspaceEmployees(workspaceId: string, projectId?: string) { return this.get<WorkspaceEmployee[]>(`/workspace/employee/list?workspaceId=${encodeURIComponent(workspaceId)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`); }
  employeeCandidates(workspaceId: string, projectId?: string) { return this.get<WorkspaceEmployee[]>(`/workspace/employee/candidates?workspaceId=${encodeURIComponent(workspaceId)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`); }
  employeePage(workspaceId: string, projectId?: string, cursor?: string) {
    const query = new URLSearchParams({workspaceId, limit: '100'});
    if (projectId) query.set('projectId', projectId);
    if (cursor) query.set('cursor', cursor);
    return this.get<WorkspaceEmployeePage>(`/workspace/employee/page?${query}`);
  }
  associateEmployee(workspaceId: string, employeeId: string) { return this.post<WorkspaceEmployee>('/workspace/employee/create', {workspaceId, employeeId}); }
  async removeEmployeeAssociation(id: string) { await this.authed((token) => deleteAuthedEnvelope<unknown>(`${this.base}/workspace/employee/delete/${encodeURIComponent(id)}`, token)); }
  async tasks(view: 'active_tasks_v1' | 'history_tasks_v1', scope: TaskScope, cursor?: string): Promise<TaskFeedPage> {
    if (view === 'active_tasks_v1' && !scope.workspaceId) throw new Error('Active tasks require a workspace');
    if (scope.projectId && scope.unprojected) throw new Error('Conflicting project filters');
    const query = new URLSearchParams({view, limit: '20'});
    for (const key of ['workspaceId', 'projectId', 'employeeId'] as const) if (scope[key]) query.set(key, scope[key]);
    if (scope.unprojected) query.set('unprojected', 'true');
    if (cursor) query.set('cursor', cursor);
    const page = await this.get<TaskFeedPage & {nextCursor?: string | null}>(`/workspace/activity/page?${query}`);
    const olderCursor = page.nextCursor === undefined ? page.olderCursor : page.nextCursor;
    return {...page, olderCursor, hasOlder: page.hasOlder ?? !!olderCursor, refreshRequired: page.refreshRequired ?? false};
  }
  items(id: string) { return this.get<WorkItem[]>(`/workspace/work-item/list?workspaceId=${encodeURIComponent(id)}`); }
  item(id: string) { return this.get<WorkItem>(`/workspace/work-item/get/${encodeURIComponent(id)}`); }
  records(executionId: string, afterSeq = '0') {
    return this.get<SessionRecordsPage>(`/agent/sessions/records?executionId=${encodeURIComponent(executionId)}&afterSeq=${encodeURIComponent(afterSeq)}&limit=50`);
  }
  bindings(id: string) { return this.get<Binding[]>(`/workspace/agent-binding/list?workspaceId=${encodeURIComponent(id)}`); }
  inbox(workspaceId: string) { return this.get<{entries: WorkspaceInboxEntry[]}>(`/workspace/inbox/list?workspaceId=${encodeURIComponent(workspaceId)}`); }
  answerDecision(decisionId: string, requestId: string, optionId: string) { return this.post<unknown>('/workspace/work-decision/answer', {decisionId, requestId, optionId}); }
  resolvePermission(executionId: string, commandId: string, permissionId: string, requestDigest: string, decision: 'allow_once' | 'deny') {
    return this.post<Command>('/agent/permissions/resolve', {executionId, commandId, permissionId, requestDigest, decision});
  }
  join(workspaceId: string) { return this.post<RoomTicket>('/workspace/room/join', { workspaceId }); }
  nodes() { return this.get<Node[]>('/agent/nodes'); }
  employees() { return this.get<Employee[]>('/agent/agents'); }
  createEmployee(body: EmployeeCreateRequest) { return this.post<Employee>('/agent/agents', body); }
  updateEmployee(body: EmployeeUpdateRequest) { return this.post<Employee>('/agent/agents/update', body); }
  sendEmployee(body: EmployeeSendRequest) { return this.post<Execution>('/agent/agents/send', body); }
  executions(nodeId: string) { return this.get<Execution[]>(`/agent/executions/list?nodeId=${encodeURIComponent(nodeId)}`); }
  execution(id: string) { return this.get<Execution>(`/agent/executions/get?executionId=${encodeURIComponent(id)}`); }
  command(executionId: string, commandId: string) { return this.get<Command>(`/agent/commands/get?executionId=${encodeURIComponent(executionId)}&commandId=${encodeURIComponent(commandId)}`); }
  permissions(id: string) { return this.get<Permission[]>(`/agent/permissions/list?executionId=${encodeURIComponent(id)}`); }
  events(id: string, afterSeq: number) { return this.get<{items: NodeEvent[]; nextCursor?: string; snapshotRequired: boolean}>(`/agent/sessions/events?executionId=${encodeURIComponent(id)}&afterSeq=${afterSeq}&limit=100`); }
}
