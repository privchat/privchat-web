// PlainMessageList — the un-virtualized timeline implementation,
// extracted as the R5.1 seam and now living behind the entry-level
// `MessageList` chooser (R5.2). When the
// `VITE_PRIVCHAT_VIRTUAL_TIMELINE` flag is unset (the default), this
// is the path the app takes — byte-for-byte the same as before R5.2.
// The R5 design note (docs/VIRTUAL_TIMELINE_DESIGN.md) is
// authoritative for the eventual virtual rewrite.
//
// What lives here:
//   - the scrollable container (single flex child, owns the scrollbar)
//   - the "load older" header chip
//   - the "no messages" empty-state chip
//   - the messages.map → MessageRow
//   - all scroll-position controllers (initial position, stick-to-
//     bottom on new messages, save-anchor-on-unmount)
//   - reply-jump DOM helper (pure scroll/highlight, no fetch)
//
// What does NOT live here:
//   - the conversation header
//   - the composer / upload chips / reply-preview / dialogs
//   - voice-playback stopAll on conversation switch (that's keyed on
//     ConversationPanel's lifecycle, not on the list-render seam)
//
// The contract this seam exposes is intentionally narrow: a flat
// MessageItemVM[] in, a callback for "user wants to reply to this
// row", and the channel-scoped data needed to render rows. R5.2 can
// swap the inside for a virtualizer without changing this surface.

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  loadScrollAnchor,
  saveScrollAnchor,
} from './scroll-positions';
import { MessageRow } from './message-row';
import type { MessageListProps } from './message-list';

export function PlainMessageList({
  messages,
  channelId,
  selfUid,
  peerReadPts,
  peerName,
  isOpening,
  reachedBeginning,
  loadingOlder,
  onLoadOlder,
  onReply,
}: MessageListProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Track "is the user at the bottom right now". If they are, new
  // messages keep them at the bottom; if they've scrolled up to read
  // history, new messages should NOT yank them down (a classic chat
  // app sin). Threshold of 32px is enough to absorb sub-pixel
  // browser quirks without classifying "almost-bottom" as "scrolled".
  const atBottomRef = useRef(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el === null) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  }, []);

  // First-render gate: until we've handled the initial mount (anchor
  // restore OR scroll-to-bottom), the "stick to bottom on new msg"
  // effect should NOT fire — otherwise it races the restore.
  const initialPositionedRef = useRef(false);

  // On mount + when messages first land, position the timeline:
  //   - If the user has a saved anchor for this channel and it's not
  //     "at bottom", scroll to that anchor's row.
  //   - Otherwise jump to the bottom (the existing R1 behaviour).
  // After this runs once, subsequent message additions only stick-
  // to-bottom when the user IS at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    if (initialPositionedRef.current) return;
    if (messages.length === 0) return;
    const anchor = loadScrollAnchor(channelId);
    if (anchor !== undefined && !anchor.atBottom && anchor.messageId !== undefined) {
      const target = el.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(anchor.messageId)}"]`,
      );
      if (target !== null) {
        // Position the row at the anchor's saved offset from the top.
        const rowTop = target.offsetTop;
        el.scrollTop = rowTop - anchor.offsetFromTop;
        initialPositionedRef.current = true;
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        return;
      }
      // Anchor row not in window (paged out). Fall through to bottom.
    }
    el.scrollTop = el.scrollHeight;
    initialPositionedRef.current = true;
    atBottomRef.current = true;
  }, [messages.length, channelId]);

  // Stick-to-bottom on new messages — only AFTER initial position is
  // settled, and only when the user is currently at the bottom. R5
  // virtual-scroll will replace this controller.
  useEffect(() => {
    if (!initialPositionedRef.current) return;
    if (!atBottomRef.current) return;
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // On unmount (or channel switch): capture the current anchor so the
  // next visit lands here. We pick the topmost row in the viewport as
  // the anchor — using the bottom would mean newly-arrived messages
  // shift the user's perceived position when they return.
  useEffect(() => {
    return () => {
      const el = scrollRef.current;
      if (el === null) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      let messageId: string | undefined;
      let offsetFromTop = 0;
      if (!atBottom) {
        const rows = el.querySelectorAll<HTMLElement>('[data-message-id]');
        for (const r of Array.from(rows)) {
          const top = r.offsetTop;
          if (top + r.offsetHeight > el.scrollTop) {
            messageId = r.dataset.messageId;
            offsetFromTop = top - el.scrollTop;
            break;
          }
        }
      }
      saveScrollAnchor(channelId, { messageId, offsetFromTop, atBottom });
    };
  }, [channelId]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      // min-h-0 is mandatory: flex items default to min-height: auto which
      // grows to fit content and defeats overflow-y-auto.
      className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2"
    >
      <div className="flex justify-center pb-2">
        {reachedBeginning ? (
          <span className="text-xs text-muted-foreground">{t('panel.beginning')}</span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={onLoadOlder}
            disabled={loadingOlder}
          >
            {loadingOlder ? t('panel.loading_older') : t('panel.load_older')}
          </Button>
        )}
      </div>

      {messages.length === 0 && !isOpening && (
        <div className="text-center text-sm text-muted-foreground py-8">
          {t('panel.no_messages')}
        </div>
      )}

      {messages.map((m) => {
        const replyVm =
          m.reply_to !== undefined
            ? messages.find((x) => x.server_message_id === m.reply_to)
            : undefined;
        return (
          <MessageRow
            key={m.record_key}
            vm={m}
            peerReadPts={peerReadPts}
            channelId={channelId}
            peerName={peerName}
            selfUid={selfUid}
            replyVm={replyVm}
            onReply={() => onReply(m)}
            onJumpToReply={(targetId) => jumpToMessage(targetId, scrollRef.current)}
          />
        );
      })}
    </div>
  );
}

/** Locate the DOM row anchored at `[data-message-id="<server_message_id>"]`
 *  inside the given scroll container, smooth-scroll it into view, and
 *  briefly flash a highlight on the row so the user can find what they
 *  jumped to. Falls back to a tiny "out of window" toast when the row
 *  isn't currently rendered (paging not yet implemented this round).
 *
 *  Implemented as a free function rather than a hook because it's a
 *  one-shot DOM operation called from a click handler, not a render-
 *  time concern. */
function jumpToMessage(
  serverMessageId: string,
  scrollContainer: HTMLDivElement | null,
): void {
  if (scrollContainer === null) return;
  const target = scrollContainer.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(serverMessageId)}"]`,
  );
  if (target === null) {
    // Tiny toast — we don't have a toast system mounted yet; a small
    // floating div appended to the scroll container is good enough
    // for a "not in this window" hint that auto-dismisses.
    const hint = document.createElement('div');
    hint.textContent = '· Original message not loaded in this window ·';
    hint.className =
      'absolute left-1/2 top-2 -translate-x-1/2 z-30 rounded bg-foreground/80 px-2 py-1 text-[11px] text-background pointer-events-none';
    scrollContainer.appendChild(hint);
    setTimeout(() => hint.remove(), 1500);
    return;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Highlight pulse: a CSS class that adds a temporary background.
  // Removed after 1500ms via setTimeout — no animation library needed.
  target.classList.add('bg-primary/15');
  setTimeout(() => target.classList.remove('bg-primary/15'), 1500);
}
