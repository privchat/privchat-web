import type { ArchivedNodeEvent, Member, Project, ProjectBinding, SessionRecordsPage, TaskFeedPage, Workspace, WorkspaceApi, WorkspaceEmployee, WorkAssignRequest } from '../../src/features/workspace/api';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type RecordsContract = Assert<Equal<Awaited<ReturnType<WorkspaceApi['records']>>, SessionRecordsPage>>;
export type RecordsCoverage = Assert<Equal<SessionRecordsPage['coverage'], 'normalized_events_only'>>;
export type RecordsEvents = Assert<Equal<SessionRecordsPage['items'], ArchivedNodeEvent[]>>;
export type ArchiveVersion = Assert<Equal<ArchivedNodeEvent['protocolVersion'], 1>>;
export type ArchiveOwnership = Assert<Equal<ArchivedNodeEvent['executionId'], string>>;
export type RecordsCursor = Assert<Equal<SessionRecordsPage['nextCursor'], string | null>>;
export type TaskCursor = Assert<Equal<TaskFeedPage['olderCursor'], string | null>>;
// §20: a project belongs to exactly one workspace; management is role-based, not a per-user writable flag.
export type ProjectWorkspace = Assert<Equal<Project['workspaceId'], string>>;
export type ProjectManagePermission = Assert<Equal<Project['manageable'], boolean>>;
export type ProjectBindings = Assert<Equal<Project['bindings'], ProjectBinding[]>>;
export type BindingOwnership = Assert<Equal<ProjectBinding['mine'], boolean>>;
export type BindingDirectoryAccess = Assert<Equal<ProjectBinding['directories'][number]['access'], 'write' | 'read'>>;
export type SpaceRole = Assert<Equal<Workspace['myRole'], string>>;
export type MemberContract = Assert<Equal<Awaited<ReturnType<WorkspaceApi['members']>>, Member[]>>;
export type EmployeeProjects = Assert<Equal<WorkspaceEmployee['projectIds'], string[]>>;
export type ScopedProjects = Assert<Equal<Awaited<ReturnType<WorkspaceApi['projects']>>, Project[]>>;
export type SpaceRead = Assert<Equal<Awaited<ReturnType<WorkspaceApi['space']>>, Workspace>>;
export type AssignBinding = Assert<Equal<WorkAssignRequest['bindingId'], string>>;
export const workspaceProject = {id: 'p', workspaceId: 'w', name: 'Project', archived: 0, version: 1, description: '', manageable: true, roundEnd: '', bindings: []} satisfies Project;
export const emptyArchive = {items: [], nextCursor: null, snapshotRequired: false, lastArchivedSeq: 0, coverage: 'normalized_events_only'} satisfies SessionRecordsPage;
// @ts-expect-error A complete-tool-log claim is not part of this contract.
export const invalidCoverage: SessionRecordsPage['coverage'] = 'complete_tool_log';
// @ts-expect-error The cursor is a wire string, never a numeric ID.
export const invalidCursor: SessionRecordsPage['nextCursor'] = 123;
// @ts-expect-error Archive events must carry explicit execution ownership and protocol version.
export const unscopedArchive: ArchivedNodeEvent = {seq: 1, eventId: 'event-1', kind: 'state', payload: {state: 'running'}};
// @ts-expect-error §20 projects cannot exist without their workspace.
export const orphanProject: Project = {...workspaceProject, workspaceId: null};
// @ts-expect-error Legacy per-user writable flags are not part of the project contract.
export const legacyWritable: Project = {...workspaceProject, writable: true};
// @ts-expect-error Assignments target a binding, never a legacy project target.
export const legacyAssign: WorkAssignRequest = {workItemId: 'i', version: 1, projectTargetId: 't', employeeId: 'e', requestId: 'r', text: 'go'};
