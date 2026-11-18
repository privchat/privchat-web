import { useTranslation } from 'react-i18next';
import type { WorkExecution, WorkItem, WorkNote, WorkReview } from './api';
import type { TaskEntry } from './task-conversation';
import { usePageLabels } from './page-labels';

export function FrozenReviewEvidence({review, notes = []}: {review: WorkReview; notes?: WorkNote[]}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  return <>
    <p>{label('reviewSource')}: {review.sourceWorkExecutionId} · v{review.workItemVersion}</p>
    <p className="whitespace-pre-wrap">{label('evidenceDescription')}: {review.evidenceDescription}</p>
    {review.evidenceNoteIds.map(id => <p key={id}>{label('records')} #{id} {notes.find(note => note.id === id)?.artifactRef ?? ''}</p>)}
  </>;
}

export function currentReview(item: WorkItem, entries: TaskEntry[], runs: WorkExecution[], reviews: WorkReview[]) {
  const cycle = entries.filter(e => e.kind === 'cycle').at(-1);
  if (cycle?.state !== 'recommendation_passed' || !cycle.workExecutionId || !cycle.reviewWorkExecutionId ||
      cycle.workExecutionId === cycle.reviewWorkExecutionId) return;
  const turns = entries.filter(e => e.kind === 'turn');
  const developer = turns.filter(e => e.role === 'developer').at(-1);
  const reviewer = turns.at(-1);
  if (developer?.workExecutionId !== cycle.workExecutionId || reviewer?.role !== 'reviewer' ||
      reviewer.workExecutionId !== cycle.reviewWorkExecutionId || reviewer.at > cycle.at) return;
  const source = runs.find(r => r.id === cycle.workExecutionId);
  const target = runs.find(r => r.id === cycle.reviewWorkExecutionId);
  if (!source?.executionId || !target?.executionId || source.detached || target.detached || source.state !== 'succeeded' || target.state !== 'succeeded' ||
      source.workItemVersion !== item.version || target.workItemVersion !== item.version) return;
  const matches = reviews.filter(r => r?.workItemId === item.id && r.workItemVersion === item.version &&
    r.sourceWorkExecutionId === source.id && r.sourceExecutionId === source.executionId &&
    r.reviewerExecution?.id === target.id && !r.reviewerExecution.detached && r.reviewerExecution.executionId === target.executionId &&
    r.reviewerExecution.workItemVersion === item.version && r.reviewerExecution.state === 'succeeded' &&
    Array.isArray(r.evidenceNoteIds) && r.evidenceNoteIds.every(id => typeof id === 'string') &&
    typeof r.evidenceDescription === 'string' && r.evidenceDescription.trim());
  return matches.length === 1 ? matches[0] : undefined;
}

export function DeliverySummary({review, loading}: {review?: WorkReview; loading: boolean}) {
  const l = usePageLabels();
  const {t} = useTranslation();
  return <details data-testid="delivery-summary" className="my-4 space-y-2 break-words text-sm text-muted-foreground">
    <summary className="cursor-pointer font-medium">{l('deliverySummary')}</summary>
    {review && <>
      <p>{l('deliveryRecommendation')}</p>
      <FrozenReviewEvidence review={review}/>
      {review.conclusionSource === 'human_recorded' && review.conclusionNoteId && ['passed', 'changes_requested'].includes(review.conclusion ?? '') && <>
        <p>{t('agentWorkspace.reviewConclusion')}: {t(`agentWorkspace.${review.conclusion === 'passed' ? 'reviewPassed' : 'changesRequested'}`)}</p>
        {review.conclusionBody && <p className="whitespace-pre-wrap">{t('agentWorkspace.reviewReason')}: {review.conclusionBody}</p>}
      </>}
    </>}
    <p className="text-muted-foreground">{l(loading ? 'loading' : review ? 'unverifiedRemainder' : 'unverifiedDelivery')}</p>
  </details>;
}
