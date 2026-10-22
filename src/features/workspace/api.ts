import { getEnvelope, postAuthedEnvelope, requireData } from '@/lib/platform-envelope';
import { getActiveAccessToken } from '@/lib/active-access-token';
import { getPlatformBaseUrl } from '@/lib/account-mode';
import { normalizePlatformBaseUrl } from '@/lib/platform-base-url';
import { PlatformApiError } from '@/lib/platform-errors';

export interface Workspace { id: string; name: string; description: string; archived: number; myRole: string }
export interface WorkItem { id: string; workspaceId: string; title: string; description: string; status: string; version: number }
export interface WorkNote { id: string; workItemId: string; kind: string; body: string; artifactRef?: string | null }
export interface Binding { id: string; nodeId: string; capability: string; revoked: number }
export interface Execution { executionId: string; nodeId: string; state: string; stateVersion: number; result?: unknown; capability?: string; scope?: {kind: string; ref: string}; nativeSessionId?: string | null; agentId?: string | null; params?: Record<string, unknown>; updatedAt?: number; createdAt?: number }
export interface WorkExecution { id: string; executionId: string | null; state: string | null }
export interface Node { nodeId: string; name: string; state: string; granted: string[]; capabilities?: {name: string; available: boolean; version?: string; reason?: string | null}[]; workdirs?: {id: string; label: string}[]; sessionDiscovery?: {external: boolean; reason: string} }
export interface Employee { agentId: string; name: string; executor: string; config: Record<string, unknown>; createdAt: number; nodeId?: string; roleDescription: string; title: string; model: string; workdirBindingId: string; executionId?: string }
export interface EmployeeConfig { name: string; executor: string; nodeId: string; roleDescription: string; title: string; model: string; workdirBindingId: string; bindExecutionId?: string }
export type EmployeeCreateRequest = EmployeeConfig & {requestId: string};
export type EmployeeUpdateRequest = EmployeeConfig & {requestId: string; agentId: string};
export interface EmployeeSendRequest { agentId: string; requestId: string; text: string }
export interface RoomTicket { channelId: string; channelType: number; ticket: string; expiresAt: number; eventProtocolVersion: number }
export interface Command { commandId: string; executionId: string; kind: string; status: 'pending' | 'applied' | 'rejected' | 'unknown'; result?: { data?: Record<string, unknown>; error?: unknown } }
export interface Permission { permissionId: string; requestDigest: string; summary: string; expiresAt: number; status: string }
export interface NodeEvent { seq: number; kind: string; payload: Record<string, unknown> }

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
  list() { return this.get<Workspace[]>('/workspace/list'); }
  items(id: string) { return this.get<WorkItem[]>(`/workspace/work-item/list?workspaceId=${encodeURIComponent(id)}`); }
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
