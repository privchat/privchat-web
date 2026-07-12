// Group join-request approval dialog (P6-3-4). Owner/admin-only surface
// reached from GroupInfoDialog's manage area. Consumes `useGroupApprovals`
// from @privchat/react — the single group-approval state machine shared
// with h5. First version is pull-based: the hook refreshes on mount and
// after each handled request (no server push yet).
//
// Each row shows the applicant (`User #<uid>`) plus their optional
// application message, with Approve / Reject buttons. approve()/reject()
// resolve to a boolean and THROW on RPC failure; we catch, report via
// captureException, and surface an inline error banner. On success the
// hook drops the row locally (optimistic), so there's nothing to remove
// here.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useGroupApprovals } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { captureException } from '@/lib/error-reporter';
import { errorText } from './error-text';

export interface GroupApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Group id (== channel_id by server invariant). */
  groupId: string;
}

export function GroupApprovalDialog({
  open,
  onOpenChange,
  groupId,
}: GroupApprovalDialogProps) {
  const { t } = useTranslation();
  // Gate the fetch on `open`: the hook refreshes on mount and whenever
  // `groupId` changes, and no-ops on an undefined/empty id. Passing
  // `undefined` while closed keeps the list lazy — no request fires until
  // the owner/admin actually opens this dialog.
  const { items, loading, error, refresh, approve, reject } =
    useGroupApprovals(open ? groupId : undefined);

  // Per-row busy guard so concurrent approve/reject clicks queue cleanly.
  // Tracks which action is in flight so the spinner lands on the button
  // that was pressed.
  const [busy, setBusy] = useState<{
    id: string;
    action: 'approve' | 'reject';
  } | null>(null);
  // Inline action error (approve/reject RPC throw). Distinct from the
  // hook's list-load `error` flag; cleared on the next action attempt.
  const [actionError, setActionError] = useState<string | null>(null);

  const handle = async (requestId: string, action: 'approve' | 'reject') => {
    if (busy !== null) return;
    setBusy({ id: requestId, action });
    setActionError(null);
    try {
      if (action === 'approve') {
        await approve(requestId);
      } else {
        await reject(requestId);
      }
      // Success drops the row inside the hook — nothing to do locally.
    } catch (e) {
      captureException(e, { source: `group-approval.${action}` });
      setActionError(`${t('groups.approvals_action_failed')}: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('groups.approvals_title')}</DialogTitle>
        </DialogHeader>
        {actionError !== null && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {actionError}
          </div>
        )}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            // Terminal list-load failure — keep it visible + retryable.
            <div className="flex flex-col items-center gap-2 py-6">
              <div className="text-sm text-muted-foreground">
                {t('groups.approvals_load_failed')}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
                data-testid="group-approvals-retry"
              >
                {t('groups.approvals_retry')}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t('contacts.pending_empty')}
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((it) => {
                const rejecting =
                  busy?.id === it.request_id && busy.action === 'reject';
                const approving =
                  busy?.id === it.request_id && busy.action === 'approve';
                const hasMessage =
                  it.message !== undefined &&
                  it.message !== null &&
                  it.message !== '';
                return (
                  <li
                    key={it.request_id}
                    className="flex items-center gap-3 py-2"
                    data-testid="group-approval-row"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {t('app.unknown_user', { id: it.user_id })}
                      </div>
                      {hasMessage && (
                        <div className="truncate text-xs text-muted-foreground">
                          {it.message}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={busy !== null}
                      onClick={() => void handle(it.request_id, 'reject')}
                      data-testid="group-approval-reject"
                    >
                      {rejecting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        t('groups.approvals_reject')
                      )}
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={busy !== null}
                      onClick={() => void handle(it.request_id, 'approve')}
                      data-testid="group-approval-approve"
                    >
                      {approving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        t('groups.approvals_approve')
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
