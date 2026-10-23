import type { ArchivedNodeEvent, SessionRecordsPage, WorkspaceActivityPage, WorkspaceApi } from '../../src/features/workspace/api';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type ActivityContract = Assert<Equal<Awaited<ReturnType<WorkspaceApi['activity']>>, WorkspaceActivityPage>>;
export type RecordsContract = Assert<Equal<Awaited<ReturnType<WorkspaceApi['records']>>, SessionRecordsPage>>;
export type RecordsCoverage = Assert<Equal<SessionRecordsPage['coverage'], 'normalized_events_only'>>;
export type RecordsEvents = Assert<Equal<SessionRecordsPage['items'], ArchivedNodeEvent[]>>;
export type ArchiveVersion = Assert<Equal<ArchivedNodeEvent['protocolVersion'], 1>>;
export type ArchiveOwnership = Assert<Equal<ArchivedNodeEvent['executionId'], string>>;
export type ActivityCursor = Assert<Equal<WorkspaceActivityPage['nextCursor'], string | null>>;
export type RecordsCursor = Assert<Equal<SessionRecordsPage['nextCursor'], string | null>>;
export const emptyArchive = {items: [], nextCursor: null, snapshotRequired: false, lastArchivedSeq: 0, coverage: 'normalized_events_only'} satisfies SessionRecordsPage;
// @ts-expect-error A complete-tool-log claim is not part of this contract.
export const invalidCoverage: SessionRecordsPage['coverage'] = 'complete_tool_log';
// @ts-expect-error The cursor is a wire string, never a numeric ID.
export const invalidCursor: WorkspaceActivityPage['nextCursor'] = 123;
// @ts-expect-error Archive events must carry explicit execution ownership and protocol version.
export const unscopedArchive: ArchivedNodeEvent = {seq: 1, eventId: 'event-1', kind: 'state', payload: {state: 'running'}};
