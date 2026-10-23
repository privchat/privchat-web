import { deleteAuthedEnvelope, getEnvelope, postAuthedEnvelope, putEnvelope, requireData } from '@/lib/platform-envelope';
import { getActiveAccessToken } from '@/lib/active-access-token';
import { getPlatformBaseUrl } from '@/lib/account-mode';
import { normalizePlatformBaseUrl } from '@/lib/platform-base-url';
import { PlatformApiError } from '@/lib/platform-errors';

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
export interface WorkspaceActivity { item: WorkItem; latestExecution: WorkExecution | null; executionCount: number }
export interface WorkspaceActivityPage { items: WorkspaceActivity[]; nextCursor: string | null }
export interface Page<T> { list: T[]; total: number }
export interface WorkspaceSummary extends Workspace { employeeCount: number; availableEmployeeCount?: number | null; employeeAvailabilityKnown?: boolean; openItemCount: number; lastActivityAt: number | null }
export interface ProjectTarget { id?: string; nodeId: string; workdirBindingId: string }
export interface Project { id: string; workspaceId: string; name: string; archived: number; version: number; targets: ProjectTarget[] }
export interface WorkspaceEmployee { id: string; workspaceId: string; employeeId: string; name?: string | null; nodeId?: string | null; capability?: string | null; workdirBindingId?: string | null; available: boolean; unavailableReason?: string | null; projectTargetIds: string[]; roleDescription?: string; model?: string; workspaceSessionKnown?: boolean; workspaceExecutionId?: string | null; workspaceNativeSessionId?: string | null }
export interface WorkspaceEmployeePage { items: WorkspaceEmployee[]; nextCursor: string | null; hasMore: boolean }
export interface TaskFeedPage { items: WorkspaceActivity[]; olderCursor: string | null; hasOlder: boolean; refreshRequired: boolean }
export interface SessionRecordsPage {
  items: ArchivedNodeEvent[]; nextCursor: string | null; snapshotRequired: boolean;
  lastArchivedSeq: number; coverage: 'normalized_events_only';
}

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
  async get<T>(path: string): Promise<T> {
    return requireData(await getEnvelope<T>(`${this.base}${path}`, this.access()), path);
  }
  async post<T>(path: string, body: unknown): Promise<T> {
    return requireData(await postAuthedEnvelope<T>(`${this.base}${path}`, this.access(), body), path);
  }
  async put<T>(path: string, body: unknown): Promise<T> {
    return requireData(await putEnvelope<T>(`${this.base}${path}`, this.access(), body), path);
  }
  grantNode(nodeId: string, capabilities: string[]) { return this.post<Node>('/agent/nodes/grant', {nodeId, capabilities}); }
  revokeNode(nodeId: string) { return this.post<Node>('/agent/nodes/revoke', {nodeId}); }
  approvePairing(pairingCode: string) { return this.post<PairingView>('/agent/pairing/approve', {pairingCode}); }
  list() { return this.get<Workspace[]>('/workspace/list'); }
  spaces(pageNo = 1) { return this.get<Page<WorkspaceSummary>>(`/workspace/page?pageNo=${pageNo}&pageSize=20`); }
  projects(workspaceId?: string) { return this.get<Project[]>(`/workspace/project/list${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`); }
  projectPage(pageNo = 1, workspaceId?: string) { return this.get<Page<Project>>(`/workspace/project/page?pageNo=${pageNo}&pageSize=20${workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ''}`); }
  project(id: string) { return this.get<Project>(`/workspace/project/get/${encodeURIComponent(id)}`); }
  saveProject(body: {id?: string; workspaceId: string; name: string; version?: number; targets?: ProjectTarget[]}) {
    const targets = body.targets === undefined ? {} : {targets: body.targets.map(({nodeId, workdirBindingId}) => ({nodeId, workdirBindingId}))};
    return body.id
      ? this.put<Project>('/workspace/project/update', {id: body.id, name: body.name, version: body.version, ...targets})
      : this.post<Project>('/workspace/project/create', {workspaceId: body.workspaceId, name: body.name, ...targets});
  }
  projectStatus(id: string, archived: number, version: number) { return this.put<Project>('/workspace/project/update-status', {id, archived, version}); }
  workspaceEmployees(workspaceId: string, projectId?: string) { return this.get<WorkspaceEmployee[]>(`/workspace/employee/list?workspaceId=${encodeURIComponent(workspaceId)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`); }
  employeeCandidates(workspaceId: string, projectId?: string) { return this.get<WorkspaceEmployee[]>(`/workspace/employee/candidates?workspaceId=${encodeURIComponent(workspaceId)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`); }
  employeePage(workspaceId: string, projectId?: string, cursor?: string) {
    const query = new URLSearchParams({workspaceId, limit: '100'});
    if (projectId) query.set('projectId', projectId);
    if (cursor) query.set('cursor', cursor);
    return this.get<WorkspaceEmployeePage>(`/workspace/employee/page?${query}`);
  }
  associateEmployee(workspaceId: string, employeeId: string) { return this.post<WorkspaceEmployee>('/workspace/employee/create', {workspaceId, employeeId}); }
  async removeEmployeeAssociation(id: string) { await deleteAuthedEnvelope<unknown>(`${this.base}/workspace/employee/delete/${encodeURIComponent(id)}`, this.access()); }
  taskFeed(workspaceId: string, projectId?: string, cursor?: string) {
    const query = new URLSearchParams({view: 'task_feed_v1', workspaceId, limit: '20'});
    if (projectId) query.set('projectId', projectId);
    if (cursor) query.set('cursor', cursor);
    return this.get<TaskFeedPage>(`/workspace/activity/page?${query}`);
  }
  items(id: string) { return this.get<WorkItem[]>(`/workspace/work-item/list?workspaceId=${encodeURIComponent(id)}`); }
  activity(workspaceId: string, beforeId?: string) {
    return this.get<WorkspaceActivityPage>(`/workspace/activity/page?workspaceId=${encodeURIComponent(workspaceId)}${beforeId === undefined ? '' : `&beforeId=${encodeURIComponent(beforeId)}`}&limit=20`);
  }
  records(executionId: string, afterSeq = '0') {
    return this.get<SessionRecordsPage>(`/agent/sessions/records?executionId=${encodeURIComponent(executionId)}&afterSeq=${encodeURIComponent(afterSeq)}&limit=50`);
  }
  bindings(id: string) { return this.get<Binding[]>(`/workspace/agent-binding/list?workspaceId=${encodeURIComponent(id)}`); }
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
