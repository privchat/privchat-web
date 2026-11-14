import type { WorkExecution, WorkspaceApi } from './api';
import { validateSessionRecordsPage } from './public-records';
import { getActiveAccountKey } from '@/lib/active-account';
import { ConsoleIntent, type PendingConsoleRequest } from './console-intent';

export interface TaskEntry {
  kind: string;
  id: string;
  at: number;
  role?: string | null;
  employeeId?: string | null;
  workExecutionId?: string | null;
  state?: string | null;
  text?: string | null;
  delivery?: string | null;
}

export interface TaskDecision {
  id: string;
  workItemId: string;
  status: string;
  expiresAt: number;
  canAnswer: boolean;
  question: string;
  blockingReason: string;
  options: {id: string; label: string; description: string}[];
}

export const taskWorking = new Set(['accepted', 'running', 'waiting_user', 'waiting_permission', 'cancelling']);

export function taskIntent(api: WorkspaceApi, itemId: string, viewerId?: string) {
  const account = getActiveAccountKey();
  if (!viewerId) return new ConsoleIntent();
  const key = 'privchat.workspace.task.' + JSON.stringify([account, viewerId, api.base, itemId]);
  return new ConsoleIntent({
    assertScope(current) {
      if (current !== api || getActiveAccountKey() !== account) throw new Error('Task account changed');
    },
    load() {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as PendingConsoleRequest;
      if (saved.idKey !== 'requestId' || typeof saved.body?.requestId !== 'string' ||
          !(saved.path === '/workspace/work-decision/answer'
            ? typeof saved.body.decisionId === 'string' && typeof saved.body.optionId === 'string'
            : ['/workspace/work-instruction/send', '/workspace/work-instruction/pause'].includes(saved.path) && saved.body.workItemId === itemId))
        throw new Error('Invalid task recovery record');
      return saved;
    },
    save(pending) {
      if (pending) sessionStorage.setItem(key, JSON.stringify(pending));
      else sessionStorage.removeItem(key);
    },
  });
}

export async function taskResult(api: WorkspaceApi, run: WorkExecution): Promise<string | undefined> {
  const id = run.executionId;
  if (!id || run.state !== 'succeeded' || run.deliveryBlockedReason) return;
  let page = validateSessionRecordsPage(await api.records(id), id);
  if (page.snapshotRequired) return;
  if (page.nextCursor) {
    const cursor = String(Math.max(0, page.lastArchivedSeq - 50));
    page = validateSessionRecordsPage(await api.records(id, cursor), id, cursor);
    if (page.snapshotRequired) return;
  }
  for (const event of [...page.items].reverse()) {
    if (event.kind !== 'output' || !Array.isArray(event.payload.items)) continue;
    const output = [...event.payload.items].reverse().find(item => item?.id === `weey-final-${id}` &&
      item.kind === 'assistant_text' && item.nativeKind == null && typeof item.text === 'string');
    const raw = output?.text.trim();
    if (!raw) continue;
    if (/^```json\b/i.test(raw)) return;
    // Structured review output is not a chat bubble or an acceptance decision.
    if (/^[{[]/.test(raw)) {
      try {
        const value = JSON.parse(raw);
        if (value?.schemaVersion === 1 && typeof value.cycleNoteId === 'string' && typeof value.sourceWorkExecutionId === 'string' &&
            ['passed', 'changes_requested', 'blocked'].includes(value.recommendation) && Array.isArray(value.findings))
          return value.findings.filter((entry: unknown) => typeof entry === 'string').map((entry: string) => `- ${entry}`).join('\n') || undefined;
        return;
      } catch { /* not JSON, keep the original text */ }
    }
    return raw;
  }
}
