import type { WorkExecution, WorkReview } from './api';

export function deliveryReceipt(result: WorkExecution | WorkReview): WorkExecution {
  return 'reviewerExecution' in result ? result.reviewerExecution : result;
}
/** Waiting for its project directory while another turn works there: accepted, delivered when it frees. */
export function isQueued(execution: Pick<WorkExecution, 'deliveryBlockedReason'> | null | undefined): boolean {
  return execution?.deliveryBlockedReason === 'WORKDIR_BUSY';
}
/** Delivery was refused (not merely queued for a busy directory). */
export function isBlocked(execution: Pick<WorkExecution, 'deliveryBlockedReason'> | null | undefined): boolean {
  return !!execution?.deliveryBlockedReason && !isQueued(execution);
}
/** An accepted identity is not proof that its held command was delivered. */
export function retainBlockedDelivery(result: WorkExecution | WorkReview): boolean {
  return isBlocked(deliveryReceipt(result));
}
