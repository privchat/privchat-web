import type { WorkExecution, WorkReview } from './api';

export function deliveryReceipt(result: WorkExecution | WorkReview): WorkExecution {
  return 'reviewerExecution' in result ? result.reviewerExecution : result;
}
/** An accepted identity is not proof that its held command was delivered. */
export function retainBlockedDelivery(result: WorkExecution | WorkReview): boolean {
  return !!deliveryReceipt(result).deliveryBlockedReason;
}
