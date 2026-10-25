import type {WorkItem} from './api';

const stages = new Set([
  'development', 'development_pending', 'development_blocked', 'waiting_user',
  'awaiting_review', 'awaiting_acceptance', 'reviewing', 'unassigned',
  'review_pending', 'review_blocked', 'awaiting_review_record',
  'changes_requested', 'review_passed',
]);

/** Business status owns closure; execution state never supplies a missing stage. */
export function taskStageLabel(row: {stage?: string | null; item: Pick<WorkItem, 'status'>}, translate: (key: string) => string) {
  if (row.item.status === 'done' || row.item.status === 'cancelled') {
    return translate(`agentWorkspace.status_${row.item.status}`);
  }
  const stage = row.stage && stages.has(row.stage) ? row.stage : 'unknown';
  return translate(`agentWorkspace.stage_${stage}`);
}
