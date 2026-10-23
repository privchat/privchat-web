import type { NodeEvent, SessionRecordsPage } from './api';

/** Reject malformed archive pages before rendering; sorting must never disguise cross-turn or sequence errors. */
export function validateSessionRecordsPage(value: unknown, executionId: string, afterSeq = '0'): SessionRecordsPage {
  const page = value as SessionRecordsPage | null;
  const after = Number(afterSeq);
  const invalid = () => { throw new Error('Invalid records page'); };
  if (!/^\d+$/.test(afterSeq) || !Number.isSafeInteger(after) || !page || page.coverage !== 'normalized_events_only' ||
      !Array.isArray(page.items) || typeof page.snapshotRequired !== 'boolean' ||
      !Number.isSafeInteger(page.lastArchivedSeq) || page.lastArchivedSeq < 0 ||
      !(page.nextCursor === null || typeof page.nextCursor === 'string')) return invalid();
  let previous = after;
  for (const event of page.items) {
    if (!event || event.protocolVersion !== 1 || event.executionId !== executionId ||
        typeof event.eventId !== 'string' || !event.eventId || typeof event.kind !== 'string' ||
        !Number.isSafeInteger(event.seq) || event.seq <= previous || event.seq > page.lastArchivedSeq ||
        !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return invalid();
    previous = event.seq;
  }
  if (page.nextCursor !== null && (!page.items.length || page.nextCursor !== String(previous) || previous <= after)) return invalid();
  return page;
}

export const executionStates = ['accepted', 'dispatched', 'queued', 'running', 'waiting_user', 'waiting_permission', 'cancelling', 'succeeded', 'failed', 'cancelled', 'unknown', 'pending'];
export const itemStates = ['open', 'in_progress', 'done', 'cancelled'];
export interface PublicRecord { kind: string; text?: string; state?: string }

/** Only normalized public DTO fields; never stringify payloads, native kinds, reasoning or tool inputs. */
export function publicRecords(event: NodeEvent): PublicRecord[] {
  const payload = event.payload;
  if (event.kind === 'state') return typeof payload.state === 'string' && executionStates.includes(payload.state) ? [{kind: 'state', state: payload.state}] : [];
  if (event.kind === 'gap' || event.kind === 'history_invalidated') return [{kind: 'gap'}];
  if (event.kind === 'permission_requested' || event.kind === 'permission_resolved') return [{kind: event.kind}];
  if (event.kind !== 'output' || !Array.isArray(payload.items)) return [];
  return payload.items.flatMap((item: unknown): PublicRecord[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (!['user_text', 'assistant_text', 'tool_summary', 'artifact', 'notice'].includes(String(row.kind))) return [];
    if (typeof row.nativeKind === 'string' && /reasoning|thinking|analysis/i.test(row.nativeKind)) return [];
    return typeof row.text === 'string' && row.text.trim() ? [{kind: String(row.kind), text: row.text}] : [];
  });
}
