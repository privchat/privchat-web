// MessageRow + co-located helpers, lifted out of ConversationPanel as
// part of R5.1. Behavior is byte-for-byte identical to the previous
// inline definitions; this is a pure relocation so the upcoming
// MessageList component (and, eventually, the virtualized timeline)
// can import a stable row renderer without creating a back-edge into
// ConversationPanel.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import {
  useDiscardMessage,
  useFriendship,
  useRetryMessage,
  useRevokeMessage,
  useUserProfile,
} from '@privchat/react';
import type { MessageItemVM } from '@privchat/react';
import { pickMediaBubble } from './media-bubbles';
import { MessageReactions } from './message-reactions';
import { getEntry, removeEntry, txnIdFromRecordKey } from './media-send-store';
import { useMediaSender } from './use-media-send';
import { Avatar } from './avatar';
import { ProfileCard } from './profile-card';
import { errorText } from './error-text';
import { captureException } from '@/lib/error-reporter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function MessageRow({
  vm,
  peerReadPts,
  channelId,
  peerName,
  selfUid,
  replyVm,
  onReply,
  onJumpToReply,
}: {
  vm: MessageItemVM;
  peerReadPts: string | undefined;
  channelId: string;
  /** Display name for the OTHER party — used in the "{name} 撤回了一条消息"
   *  placeholder. Undefined for groups (we'd need per-message sender
   *  resolution; a "someone recalled" generic message is acceptable). */
  peerName?: string;
  /** Current user's uid; needed by the reactions row to highlight
   *  the self's own emoji chips. */
  selfUid: string | undefined;
  /** When this row is a reply, the original message — looked up by
   *  `vm.reply_to` from the local cache. Undefined when the original
   *  isn't loaded (e.g. paged out of view). */
  replyVm?: MessageItemVM;
  /** Click handler for the Reply menu item. */
  onReply: () => void;
  /** Click handler for the reply-quote (jump to the original). */
  onJumpToReply: (serverMessageId: string) => void;
}) {
  const { t } = useTranslation();
  const ts = useMemo(
    () =>
      new Date(vm.timestamp).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [vm.timestamp],
  );

  // Revoked rows render as a centered system-style placeholder, not as
  // a bubble. Mirrors WeChat / Telegram convention. The original
  // bubble + actions are intentionally suppressed.
  //
  // Sender name resolution:
  //   - self: "你撤回了一条消息"
  //   - direct chat (peerName known): "{peerName} 撤回了一条消息"
  //   - group (peerName undefined): per-message lookup via
  //     `RevokedSenderName` (alias > nickname > username > generic
  //     fallback). Hook lives in the sub-component so non-revoked
  //     rows don't pay the per-row profile subscription cost.
  if (vm.revoked) {
    if (vm.is_self) {
      return (
        <div className="flex justify-center py-1">
          <span className="text-xs text-muted-foreground">
            {t('message_actions.revoked_self')}
          </span>
        </div>
      );
    }
    if (peerName !== undefined) {
      return (
        <div className="flex justify-center py-1">
          <span className="text-xs text-muted-foreground">
            {t('message_actions.revoked_peer', { name: peerName })}
          </span>
        </div>
      );
    }
    return (
      <div className="flex justify-center py-1">
        <RevokedSenderName fromUid={vm.from_uid} />
      </div>
    );
  }

  // Media bubble or text bubble. Media bubbles own their own width
  // (image dimensions, file chip width) so we don't apply the
  // max-width-75 container around them — they nest a per-type chrome.
  const mediaNode = pickMediaBubble(vm);
  // Synthetic in-flight media row (upload phase) — see media-send-store.
  const pendingTxnId = txnIdFromRecordKey(vm.record_key);

  return (
    <div
      // R3.7 / A3 anchor: the reply-jump scroll uses
      // `[data-message-id="<server_message_id>"]` as the lookup target.
      // We attach it on every row (regardless of whether anyone replies
      // to it) so the search is always a single querySelector.
      data-message-id={vm.server_message_id}
      className={cn(
        'group flex items-end gap-2 transition-colors',
        vm.is_self ? 'justify-end' : 'justify-start',
      )}
    >
      {vm.is_self && pendingTxnId === undefined && (
        <MessageActionsMenu vm={vm} channelId={channelId} side="left" onReply={onReply} />
      )}
      {!vm.is_self && <MessageRowAvatar fromUid={vm.from_uid} />}
      {mediaNode !== null ? (
        <div className="flex flex-col items-stretch gap-1">
          {vm.reply_to !== undefined && (
            <ReplyQuote
              replyVm={replyVm}
              isSelf={vm.is_self}
              onJump={() => onJumpToReply(vm.reply_to!)}
            />
          )}
          {mediaNode}
          <span
            className={cn(
              'text-[10px] font-mono opacity-70 flex items-center gap-1',
              vm.is_self ? 'self-end' : 'self-start text-muted-foreground',
            )}
          >
            <span>{ts}</span>
            {vm.is_self && pendingTxnId === undefined && (
              <SelfStatusBadge vm={vm} peerReadPts={peerReadPts} />
            )}
          </span>
          {pendingTxnId !== undefined ? (
            <MediaSendStatus txnId={pendingTxnId} />
          ) : (
            <>
              {vm.is_self && vm.outbox_status === 'failed' && (
                <FailedMessageActions
                  localMessageId={vm.local_message_id}
                  isSelf={vm.is_self}
                />
              )}
              <MessageReactions
                serverMessageId={vm.server_message_id}
                selfUid={selfUid}
                isSelf={vm.is_self}
              />
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1 max-w-[75%]">
          <div
            className={cn(
              'flex flex-col rounded-lg px-3 py-2 text-sm',
              vm.is_self
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted',
            )}
          >
            {vm.reply_to !== undefined && (
              <ReplyQuote
                replyVm={replyVm}
                isSelf={vm.is_self}
                onJump={() => onJumpToReply(vm.reply_to!)}
              />
            )}
            <span className="break-words whitespace-pre-wrap">{vm.content}</span>
            <span
              className={cn(
                'mt-1 self-end text-[10px] font-mono opacity-70 flex items-center gap-1',
                vm.is_self ? '' : 'text-muted-foreground',
              )}
            >
              <span>{ts}</span>
              {vm.is_self && <SelfStatusBadge vm={vm} peerReadPts={peerReadPts} />}
            </span>
          </div>
          {vm.is_self && vm.outbox_status === 'failed' && (
            <FailedMessageActions
              localMessageId={vm.local_message_id}
              isSelf={vm.is_self}
            />
          )}
          <MessageReactions
            serverMessageId={vm.server_message_id}
            selfUid={selfUid}
            isSelf={vm.is_self}
          />
        </div>
      )}
      {!vm.is_self && (
        <MessageActionsMenu vm={vm} channelId={channelId} side="right" onReply={onReply} />
      )}
    </div>
  );
}

/** Status / retry affordance for an in-flight (upload-phase) media row.
 *  While uploading shows a hint; on UPLOAD failure shows retry (re-runs
 *  upload+send from the in-memory Blob) + dismiss. Post-upload SEND
 *  failures never land here — the SDK's own row exists by then and the
 *  outbox FailedMessageActions owns that path. Fresh reads of the store
 *  are safe: the parent re-renders on every store notify because the
 *  synthetic VM is re-projected. */
function MediaSendStatus({ txnId }: { txnId: string }) {
  const { t } = useTranslation();
  const sender = useMediaSender();
  const [busy, setBusy] = useState(false);
  const entry = getEntry(txnId);
  if (entry === undefined) return null;

  if (entry.stage === 'uploading') {
    return (
      <span className="self-end text-[10px] text-muted-foreground">
        {t('media_send.uploading')}
      </span>
    );
  }

  const onRetry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sender.retry(txnId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="self-end flex items-center gap-2 text-[10px] text-destructive">
      <span>{t('media_send.upload_failed')}</span>
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={busy}
        className="underline disabled:opacity-50"
      >
        {busy ? t('status.retrying') : t('media_send.retry')}
      </button>
      <button
        type="button"
        onClick={() => removeEntry(txnId)}
        className="underline opacity-70"
      >
        {t('media_send.dismiss')}
      </button>
    </div>
  );
}

function FailedMessageActions({
  localMessageId,
  isSelf,
}: {
  localMessageId: string | undefined;
  isSelf: boolean;
}) {
  const { t } = useTranslation();
  const retry = useRetryMessage();
  const discard = useDiscardMessage();
  const [busy, setBusy] = useState(false);
  if (localMessageId === undefined) return null;

  const onRetry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await retry(localMessageId);
    } catch (err) {
      // The outbox engine will move the row back to 'failed' if the
      // attempt fails; nothing actionable to surface here.
      captureException(err, { source: 'failed-actions.retry' });
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = async () => {
    if (busy) return;
    if (!confirm(t('status.discard'))) return;
    setBusy(true);
    try {
      await discard(localMessageId);
    } catch (err) {
      captureException(err, { source: 'failed-actions.discard' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[11px] text-destructive',
        isSelf ? 'self-end' : 'self-start',
      )}
    >
      <span>{t('status.failed')}</span>
      <span className="text-muted-foreground">·</span>
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={busy}
        className="underline underline-offset-2 hover:text-destructive/80 disabled:opacity-50"
      >
        {busy ? t('status.retrying') : t('status.retry')}
      </button>
      <span className="text-muted-foreground">·</span>
      <button
        type="button"
        onClick={() => void onDiscard()}
        disabled={busy}
        className="text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
      >
        {t('status.discard')}
      </button>
    </div>
  );
}

/** Small clickable avatar shown to the left of inbound message bubbles.
 *  Tapping opens the sender's ProfileCard (re-using the same popover
 *  that contact rows / the chat header use). For self-rows we don't
 *  render an avatar (you know who you are) — keeps the layout tight
 *  and matches WeChat / Telegram conventions. */
function MessageRowAvatar({ fromUid }: { fromUid: string }) {
  const user = useUserProfile(fromUid);
  const display = user?.nickname ?? user?.username ?? `User #${fromUid}`;
  return (
    <ProfileCard user={user} fallbackTitle={display}>
      <button
        type="button"
        className="shrink-0 self-end"
        aria-label={display}
      >
        <Avatar seed={`u:${fromUid}`} label={display} size="sm" />
      </button>
    </ProfileCard>
  );
}

/** Resolves a uid to a display name on the fly for the group-revoke
 *  placeholder. Same precedence as the title resolver: alias >
 *  nickname > username > generic fallback. No DEV-mode raw-uid leak —
 *  if nothing's loaded yet, we say "对方撤回了一条消息" instead. */
function RevokedSenderName({ fromUid }: { fromUid: string }) {
  const { t } = useTranslation();
  const user = useUserProfile(fromUid);
  const friendship = useFriendship(fromUid);
  const name =
    friendship?.alias?.trim() !== undefined && friendship?.alias?.trim() !== ''
      ? friendship.alias.trim()
      : user?.nickname ?? user?.username;
  return (
    <span className="text-xs text-muted-foreground">
      {name !== undefined && name !== ''
        ? t('message_actions.revoked_peer', { name })
        : t('message_actions.revoked_unknown')}
    </span>
  );
}

/** A quoted-message preview rendered inside / above a bubble. Mirrors
 *  WeChat / Telegram conventions: a small grey-ish strip with the
 *  original sender's content (truncated) and a vertical accent. When
 *  the original isn't loaded locally, render a placeholder instead of
 *  the body. Clicking jumps to (and flashes) the original message —
 *  if it's not in the current window we don't fetch history (scope-
 *  bounded for this round); a polling fallback would extend the
 *  paging engine, which is R5 territory. */
function ReplyQuote({
  replyVm,
  isSelf,
  onJump,
}: {
  replyVm: MessageItemVM | undefined;
  isSelf: boolean;
  onJump: () => void;
}) {
  const { t } = useTranslation();
  const body =
    replyVm === undefined
      ? t('message_actions.reply_unavailable')
      : replyVm.content !== ''
        ? replyVm.content
        : `[${replyVm.content_type}]`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJump();
      }}
      className={cn(
        'mb-1 max-w-full rounded-md border-l-2 px-2 py-1 text-xs text-left',
        'hover:opacity-80 transition-opacity',
        isSelf
          ? 'border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground/80'
          : 'border-primary bg-muted-foreground/5 text-muted-foreground',
      )}
    >
      <div className="line-clamp-2 break-words">{body}</div>
    </button>
  );
}

/** Hover-revealed "..." trigger that opens an actions menu for a row.
 *  Self rows get Revoke + Copy; received rows get Copy only. The
 *  trigger is invisible until the row's `group:hover` fires (Tailwind
 *  group utility on the parent), so the timeline stays clean at rest. */
function MessageActionsMenu({
  vm,
  channelId,
  side,
  onReply,
}: {
  vm: MessageItemVM;
  channelId: string;
  side: 'left' | 'right';
  onReply: () => void;
}) {
  const { t } = useTranslation();
  const revoke = useRevokeMessage();
  const [busy, setBusy] = useState(false);

  // Revoke needs a server_message_id (pending rows haven't been ACKed
  // and have nothing for the server to recall yet).
  const canRevoke = vm.is_self && vm.status === 'sent' && vm.server_message_id !== undefined;
  // Copy is universal; no point on a row with no text content.
  const canCopy = vm.content !== '';
  // Reply requires the original to have a server id.
  const canReply = vm.server_message_id !== undefined;

  if (!canRevoke && !canCopy && !canReply) return null;

  const onRevoke = async () => {
    if (!canRevoke || busy) return;
    if (!confirm(t('message_actions.revoke_confirm'))) return;
    setBusy(true);
    try {
      await revoke(vm.server_message_id!, channelId);
    } catch (e) {
      alert(`${t('message_actions.revoke_failed')}: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onCopy = () => {
    void navigator.clipboard.writeText(vm.content).catch(() => {});
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'rounded-md p-1 hover:bg-accent text-muted-foreground',
            side === 'left' ? 'order-first' : 'order-last',
          )}
          aria-label="actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={side === 'left' ? 'end' : 'start'}>
        {canReply && (
          <DropdownMenuItem onSelect={() => onReply()}>
            {t('message_actions.reply')}
          </DropdownMenuItem>
        )}
        {canCopy && (
          <DropdownMenuItem onSelect={onCopy}>
            {t('message_actions.copy')}
          </DropdownMenuItem>
        )}
        {canRevoke && (
          <DropdownMenuItem
            onSelect={() => void onRevoke()}
            disabled={busy}
            className="text-destructive focus:text-destructive"
          >
            {t('message_actions.revoke')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Sender-side delivery indicator. Combines two orthogonal dimensions:
 *
 *   - `status`  — send-state machine (pending → sent → failed)
 *   - `read_by_peer` — read-receipt projection (true once peer cursor
 *                     has advanced past this row's pts)
 *
 * Visual vocabulary mirrors WhatsApp/Telegram: ⏳ pending, ✓ sent,
 * ✓✓ delivered/read (color-shift). Read state lives on its own field
 * (NOT on `status`), matching Rust SDK's split between MessageStatus
 * and `channel_extra.peer_read_pts`.
 */
function SelfStatusBadge({
  vm,
  peerReadPts,
}: {
  vm: MessageItemVM;
  peerReadPts: string | undefined;
}) {
  const { t } = useTranslation();
  // Outbox-failed wins over cache 'pending' — the SDK keeps cache
  // status at 'pending' while the outbox engine retries, but the user
  // should see ✕ once the outbox row hits 'failed'.
  if (vm.outbox_status === 'failed') {
    return (
      <span title={t('status.failed')} className="text-destructive">
        · ✕
      </span>
    );
  }
  if (vm.status === 'pending') {
    return <span title={t('status.pending')}>· ⏳</span>;
  }
  if (vm.status === 'failed') {
    return (
      <span title={t('status.failed')} className="text-destructive">
        · ✕
      </span>
    );
  }
  if (vm.status === 'sent') {
    if (vm.read_by_peer) {
      // Dev-only diagnostic: show pts vs peer cursor in the tooltip so
      // mismatches between "Web shows ✓✓" and "peer hasn't received"
      // can be inspected on hover. Surface only the inputs to the
      // projection — the projection itself is `pts <= peer_read_pts`.
      const title = import.meta.env.DEV
        ? `${t('status.read')} (pts=${vm.pts ?? '∅'} peer_read_pts=${peerReadPts ?? '∅'})`
        : t('status.read');
      return (
        <span title={title} className="text-sky-300">
          · ✓✓
        </span>
      );
    }
    return <span title={t('status.sent')}>· ✓</span>;
  }
  // Self row should never be `received` (would be a status-machine
  // bug). Render the raw token so it's loud during dogfood.
  return <span>· {vm.status}?</span>;
}
