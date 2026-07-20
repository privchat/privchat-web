// VirtualMessageList — R5.2 first-pass virtualizer behind the
// `VITE_PRIVCHAT_VIRTUAL_TIMELINE` flag. Goal at this step is
// narrow: prove the virtual path can boot and render the existing
// timeline (text + image + file + voice + reactions + reply) safely
// without breaking smoke. Anchor correctness, history-prepend
// preservation, reply-jump for paged-out targets, dynamic-height
// re-anchor, and unread markers are explicitly deferred to R5.3 /
// R5.4 — see docs/VIRTUAL_TIMELINE_DESIGN.md.
//
// Why @tanstack/react-virtual:
//   - Dynamic measured heights are first-class (`measureElement`).
//   - We own the scroll element, the lib doesn't fight us for it.
//   - Tiny, no opinionated styling, works with React 19.
//
// Behaviors implemented:
//   - render messages in a virtualized window
//   - measured-height reflow via `measureElement`
//   - "open at bottom" on first mount (per-channelId gate so R19
//     strict-mode's double-mount cycle doesn't yank the user back
//     to the bottom on subsequent updates)
//   - simple stick-to-bottom on new messages when the user is
//     already near the bottom
//   - "load older" header chip + empty-state chip + reply jump for
//     IN-WINDOW targets (i.e. inside the rendered virtual range)
//   - R5.3.1 anchor primitives (capture / restore / resolve) +
//     passive on-scroll anchor sensor in `currentAnchorRef`
//   - R5.3.2 history-prepend anchor preservation: capture before
//     `onLoadOlder`, restore in a layout effect once `messages`
//     grows past the captured length
//   - R5.3.4 dynamic-height anchor preservation: a wrapper around
//     the virtualizer's `measureElement` option compares each
//     row's previous and current measured heights; on a real
//     change (not first measure) we capture the anchor and
//     schedule a coalesced rAF that either re-parks at the bottom
//     (if user was already near-bottom) or restores the captured
//     anchor (if user was reading history)
//   - R5.3.3 local-echo → server-ACK key bridge: a layout effect
//     compares the current vs previous `messages` snapshots; when
//     `currentAnchorRef.current.recordKey` no longer resolves in
//     the new array, `resolveAnchorRecordKey` rewrites the anchor
//     to the post-ACK key (matched by `local_message_id` /
//     `server_message_id`) so subsequent restores stay valid
//
//   - R5.4 reply-jump three-state completion. `handleReplyJump`
//     handles (1) target mounted → scroll + flash inline,
//     (2) target loaded but outside the rendered window →
//     `scrollToIndex` + a layout-effect that watches the rendered
//     virtual range and applies the flash on first mount, and
//     (3) target not in the loaded `messages` array → inline
//     "out of window" toast (NO remote single-message fetch —
//     paging-by-id is intentionally out of scope, frozen in
//     `project_reply_local_only`). After every successful jump
//     we refresh `atBottomRef` and `currentAnchorRef` so
//     subsequent prepend/dynamic-height/saved-anchor restores
//     don't read pre-jump state.
//
// Behaviors deliberately NOT implemented yet:
//   - paged-out reply target retrieval (would extend paging-by-id,
//     out of scope per `project_reply_local_only`)
//   - unread marker virtual row

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import type { MessageItemVM } from '@privchat/react';
import { MessageRow } from './message-row';
import type { MessageListProps } from './message-list';
import {
  captureAnchor,
  resolveAnchorRecordKey,
  restoreAnchor,
  type TimelineAnchor,
} from './virtual-anchor';
import {
  clearVirtualScrollAnchor,
  loadVirtualScrollAnchor,
  saveVirtualScrollAnchor,
} from './scroll-positions';

// First-pass row-height estimate. The virtualizer uses this only
// until the row mounts and `measureElement` reports the real
// height; over-estimating slightly avoids "row appears, scroll
// jumps up" wobble on first paint.
const ESTIMATED_ROW_HEIGHT = 72;

// Render a few rows above and below the viewport so quick scrolls
// reveal already-mounted DOM. Higher values trade memory for
// smoothness; 8 matches the design-note default.
const OVERSCAN = 8;

// "Near the bottom" threshold — same constant the plain path uses
// for stick-to-bottom semantics. Keeping the two implementations
// agreed on one number means the user can flip the flag without
// noticing a scroll-physics difference.
const STICK_THRESHOLD_PX = 32;

export function VirtualMessageList({
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
  onForward,
  canPin,
  pinnedIds,
  onTogglePin,
  focusMessageId,
  onFocusConsumed,
}: MessageListProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    // Stable per-row keys so React reconciliation lines up with the
    // virtualizer's internal cache across local-echo → server-acked
    // transitions. Falls back to the index on the never-supposed-to-
    // happen case where `messages[index]` is undefined.
    getItemKey: (index) => messages[index]?.record_key ?? index,
    // R5.3.4: this is the virtualizer's primary entry point for both
    // first-time measurement AND ResizeObserver-driven re-measurement
    // of an already-mounted row. We piggy-back on it to detect "real"
    // height changes — first-mount measurements just populate
    // `rowHeightsRef` and return without scheduling anything; later
    // measurements that move by more than 1px trigger a rAF in which
    // we either re-restore the captured anchor (user mid-list) or
    // re-park at the bottom (user near-bottom).
    measureElement:
      typeof ResizeObserver !== 'undefined'
        ? (el, _entry, instance) => {
            const next = el?.getBoundingClientRect().height ?? 0;
            const recordKey = (el as HTMLElement | undefined)?.dataset
              .recordKey;
            if (el === undefined || recordKey === undefined) return next;
            const previous = rowHeightsRef.current.get(recordKey);
            rowHeightsRef.current.set(recordKey, next);
            // First-time measurement (estimate → actual): let the
            // virtualizer's default behaviour handle it. Restoring an
            // anchor on first measure would interfere with the initial
            // "park at bottom" effect.
            if (previous === undefined) return next;
            // Sub-pixel jitter (often 0.5px from sub-CSS rounding) —
            // never worth a re-anchor.
            if (Math.abs(previous - next) <= 1) return next;
            // Real change. Capture state BEFORE the virtualizer applies
            // this new measurement: virtualItems still reflect the
            // pre-resize layout, which is what `captureAnchor` needs.
            const wasNearBottom = atBottomRef.current;
            const scrollEl = parentRef.current;
            const anchorBeforeMeasure =
              scrollEl !== null
                ? captureAnchor(
                    scrollEl,
                    instance.getVirtualItems(),
                    messagesRef.current,
                  )
                : null;
            // Coalesce bursts (multi-image decode, rapid reaction
            // updates) into a single rAF. Cancel any previously-
            // scheduled correction so we always apply the freshest
            // anchor / near-bottom state from THIS measurement.
            if (pendingHeightRafRef.current !== null) {
              cancelAnimationFrame(pendingHeightRafRef.current);
            }
            pendingHeightRafRef.current = requestAnimationFrame(() => {
              pendingHeightRafRef.current = null;
              const liveScrollEl = parentRef.current;
              if (liveScrollEl === null) return;
              const liveMessages = messagesRef.current;
              if (wasNearBottom) {
                if (liveMessages.length > 0) {
                  instance.scrollToIndex(liveMessages.length - 1, {
                    align: 'end',
                  });
                }
                return;
              }
              if (anchorBeforeMeasure !== null) {
                restoreAnchor(
                  anchorBeforeMeasure,
                  liveScrollEl,
                  instance,
                  liveMessages,
                );
              }
            });
            return next;
          }
        : undefined,
  });

  // Stick-to-bottom controller — mirrors the plain path's behaviour
  // but expressed against the virtualizer. We track "is the user
  // near the bottom" via the scroll element directly; the
  // virtualizer doesn't expose this as a built-in.
  const atBottomRef = useRef(true);
  // We've already positioned the timeline at the bottom for THIS
  // channelId — keyed on channelId rather than a boolean so React
  // 19 strict-mode's double-mount cycle doesn't accidentally clear
  // the gate and yank the user back to the bottom on the next
  // messages update (which is exactly what a history prepend is).
  const positionedForChannelRef = useRef<string | null>(null);

  // R5.3.1: passive anchor sensor. Whenever the user scrolls (or
  // the virtualizer settles a layout), we capture "where is the
  // user looking right now" into a ref so subsequent steps
  // (R5.3.2 history-prepend, R5.3.4 dynamic-height) can restore
  // that anchor across rerenders.
  const currentAnchorRef = useRef<TimelineAnchor | null>(null);

  // R5.3.2: pending prepend record. Set when the user triggers
  // "Load older" — captures the anchor + the messages length at
  // click time. Consumed by the layout effect below once the
  // messages array grows (presumed prepend), then cleared. The
  // length-growth gate is what keeps unrelated re-renders (e.g. a
  // new inbound message landing while the prepend is in flight)
  // from accidentally triggering a restore.
  const pendingPrependRef = useRef<{
    anchor: TimelineAnchor;
    oldLength: number;
  } | null>(null);

  // R5.3.4: per-row last-known height. Populated inside the
  // virtualizer's `measureElement` option whenever a row is
  // (re-)measured. We compare incoming measurements against this
  // map to decide "is this a real height change vs the FIRST time
  // we saw this row?". First-time measurements just populate; only
  // genuine height changes (post-mount image decode, reaction add,
  // file metadata load, revoke shrink) trigger the rAF restore.
  const rowHeightsRef = useRef<Map<string, number>>(new Map());

  // R5.3.4: rAF handle for the pending dynamic-height anchor
  // restore. We coalesce bursts of measurements (multi-image
  // decode, rapid reaction toggles) into a single rAF so the
  // viewport corrects exactly once per frame instead of jittering.
  const pendingHeightRafRef = useRef<number | null>(null);

  // `measureElement` runs INSIDE the virtualizer (via ResizeObserver),
  // so it doesn't see new prop values from re-renders the way useEffect
  // does. We mirror `messages` into a ref so the height-change handler
  // always closes over the latest array.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // R5.3.3: previous-render snapshot of the messages array. Used by
  // the bridge effect below to map an anchor's `recordKey` from the
  // old projection to the new one when the row's identity flips
  // (local-echo `local:<id>` → server-acked `<server_message_id>`).
  // Updated inside the bridge effect AFTER the comparison runs so
  // both snapshots are available.
  const previousMessagesRef = useRef<ReadonlyArray<MessageItemVM>>(messages);

  // R5.4: pending reply-jump target. Set when `handleReplyJump` fires
  // for a row that is in `messages` but currently outside the
  // virtualizer's rendered window. The post-mount layout effect
  // below watches the rendered range; once the target's wrapper
  // appears in the DOM, it applies the flash highlight, refreshes
  // the anchor, and clears the ref.
  const pendingJumpRef = useRef<{
    serverMessageId: string;
    index: number;
  } | null>(null);

  // First-render-per-channel: position the timeline. The gate is keyed
  // on `channelId` so re-renders within the same channel (history
  // prepend, new inbound, etc.) never re-trigger this. Channel switch
  // flips the key and the effect re-runs against the new channel.
  //
  // Order of attempts (R5.3.5):
  //   1. If a saved anchor exists for this channel AND its `recordKey`
  //      is in the current `messages` array, restore to it.
  //   2. Otherwise (no saved anchor, or stale recordKey not yet
  //      mounted), park at the bottom — same v0 behavior.
  //
  // Stale-but-row-not-yet-loaded case: leave the saved entry alone so
  // a subsequent visit (after history pages in further) can resolve
  // it. We only clear on explicit "user was at bottom on leave" in
  // the save effect below, never on a missed restore.
  useEffect(() => {
    if (positionedForChannelRef.current === channelId) return;
    if (messages.length === 0) return;
    // Jump pending: defer to the focus effect so scroll-to-bottom can't
    // bury the matched message when the jump backfill lands first.
    if (focusMessageId !== undefined) return;

    let restored = false;
    const saved = loadVirtualScrollAnchor(channelId);
    if (saved !== undefined) {
      const idx = messages.findIndex((m) => m.record_key === saved.recordKey);
      if (idx >= 0) {
        const scrollEl = parentRef.current;
        if (scrollEl !== null) {
          restoreAnchor(saved, scrollEl, rowVirtualizer, messages);
          restored = true;
        }
      }
    }

    if (restored) {
      // Restored mid-list — explicitly NOT at bottom so stick-to-bottom
      // doesn't yank the user down on the next inbound row.
      atBottomRef.current = false;
    } else {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
      atBottomRef.current = true;
    }
    positionedForChannelRef.current = channelId;
    // The captured/pending anchors don't carry across channels.
    // Same for measured row heights — different channel, different
    // rows, can't reuse the heights from the previous one. The
    // pending reply-jump target also gets dropped: jumping into a
    // different channel's row from this one would never resolve.
    currentAnchorRef.current = null;
    pendingPrependRef.current = null;
    pendingJumpRef.current = null;
    rowHeightsRef.current = new Map();
    if (pendingHeightRafRef.current !== null) {
      cancelAnimationFrame(pendingHeightRafRef.current);
      pendingHeightRafRef.current = null;
    }
  }, [messages.length, rowVirtualizer, channelId]);

  // R5.3.5 — save the current anchor on channel switch / unmount so
  // the next visit can restore. The cleanup function captures
  // `channelId` by closure, so when channelId changes (or component
  // unmounts), we save against the OLD channel — exactly the timing
  // the plain path uses.
  //
  // Save branches:
  //   - User was at bottom: clear any stale entry. The default first-
  //     mount fallback (scroll to bottom) is the right next-visit
  //     behavior; storing a mid-list anchor here would override that.
  //   - We have a captured anchor (`currentAnchorRef.current`): save
  //     it. The on-scroll handler keeps the ref fresh for every
  //     scroll event, so this is the topmost visible row at leave.
  //   - No captured anchor (rare: opened the channel and switched
  //     away before any scroll event fired): clear so default applies.
  //
  // Reset path: also clear `positionedForChannelRef` so the next
  // mount of ANY channel — including coming back to this one —
  // re-runs the positioning effect. Without this, switching to an
  // empty channel that bails out of positioning (`messages.length
  // === 0`) leaves the ref pointing at the previous channel, and
  // coming back here would short-circuit the gate and skip restore.
  useEffect(() => {
    return () => {
      if (atBottomRef.current) {
        // User was at bottom on leave → next visit's default
        // (scroll-to-bottom) is correct; clear any prior mid-list
        // anchor so it doesn't override.
        clearVirtualScrollAnchor(channelId);
      } else {
        const anchor = currentAnchorRef.current;
        if (anchor !== null) {
          saveVirtualScrollAnchor(channelId, {
            recordKey: anchor.recordKey,
            offsetFromTop: anchor.offsetFromTop,
          });
        }
        // else: no captured anchor and not at bottom — happens in
        // React Strict Mode's double-mount cycle where this cleanup
        // fires immediately after a successful restore but before
        // any new on-scroll has filled currentAnchorRef. Leave any
        // previously saved entry alone — wiping it would defeat the
        // very restore that just happened. The legitimate "user
        // opened and left without scrolling" case lands in this
        // branch too, but there's nothing useful to write either way.
      }
      positionedForChannelRef.current = null;
    };
  }, [channelId]);

  // Cancel any pending dynamic-height rAF on unmount so the
  // coalesced restore doesn't fire against a torn-down scroll
  // element (and trip ref-null checks repeatedly).
  useEffect(() => {
    return () => {
      if (pendingHeightRafRef.current !== null) {
        cancelAnimationFrame(pendingHeightRafRef.current);
        pendingHeightRafRef.current = null;
      }
    };
  }, []);

  // Stick-to-bottom on new messages within the current channel.
  // Gated on (a) we've already done initial positioning for this
  // channel and (b) the user is currently near the bottom; the
  // second gate is what stops us from yanking the user down while
  // they're reading history.
  useEffect(() => {
    if (positionedForChannelRef.current !== channelId) return;
    if (!atBottomRef.current) return;
    if (messages.length === 0) return;
    rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
  }, [messages.length, rowVirtualizer, channelId]);

  // R5.3.2 — when a prepend is pending and `messages` has grown,
  // restore the captured anchor so the row the user was reading
  // stays at the same screen position.
  //
  // This runs in a layout effect (synchronous post-commit, before
  // paint) so the user never sees an intermediate frame where the
  // viewport is anchored at the top of the prepended page. The
  // pending ref is cleared exactly once per restore attempt — if
  // the row is somehow no longer findable, we don't retry on the
  // next render (which would interfere with normal scrolling).
  useLayoutEffect(() => {
    const pending = pendingPrependRef.current;
    if (pending === null) return;
    // Wait until the prepend actually lands. Without this gate we
    // might fire on the same-render commit before `messages` is
    // updated, or on an unrelated re-render that happened to
    // sandwich between click and resolution.
    if (messages.length <= pending.oldLength) return;
    pendingPrependRef.current = null;
    const scrollEl = parentRef.current;
    if (scrollEl === null) return;
    const restored = restoreAnchor(
      pending.anchor,
      scrollEl,
      rowVirtualizer,
      messages,
    );
    if (!restored && import.meta.env.DEV) {
      // Diagnostic only — no UI fallback. The row genuinely
      // disappeared from the new array (e.g. server compacted it),
      // so the best we can do is leave the user wherever the
      // virtualizer ended up. R5.3.3's bridge effect below covers
      // the in-place key-flip case (local-echo → server ACK).
      console.warn(
        '[virtual] prepend anchor restore failed: row not found',
        pending.anchor.recordKey,
      );
    }
  }, [messages, rowVirtualizer]);

  // R5.3.3 — local-echo → server-ACK key bridge.
  //
  // When the SDK swaps a pending row's identity in place
  // (`record_key` flips from `local:<lid>` to `<server_message_id>`),
  // any anchor we'd captured against the OLD key becomes stale.
  // Without a bridge, the next downstream consumer (dynamic-height
  // restore, future saved-anchor restore, etc.) calls findIndex
  // against the stale key, gets -1, and silently no-ops — the user
  // can drift from their reading position any time another row
  // resizes after the ACK.
  //
  // This effect:
  //   1. Compares this commit's `messages` against the previous one
  //      (kept in `previousMessagesRef`).
  //   2. If `currentAnchorRef.current` exists and its `recordKey`
  //      is no longer in `messages`, asks `resolveAnchorRecordKey`
  //      whether the same VM has reappeared under a different key
  //      via `local_message_id` or `server_message_id` mapping.
  //   3. If a bridge exists: rewrites `currentAnchorRef.current` to
  //      use the new key AND triggers a one-shot anchor restore so
  //      the row's screen position survives any incidental layout
  //      drift the projection swap might have caused (e.g. if the
  //      ACKed row's measured height differs from the local
  //      echo's). If the row genuinely vanished (no bridge), we
  //      clear `currentAnchorRef` and warn — explicitly DO NOT
  //      retry, to mirror R5.3.2's "no restore-storms" rule.
  //
  // The plain MessageList path is intentionally untouched.
  useLayoutEffect(() => {
    const oldMessages = previousMessagesRef.current;
    previousMessagesRef.current = messages;
    if (oldMessages === messages) return;

    const anchor = currentAnchorRef.current;
    if (anchor === null) return;
    if (messages.some((m) => m.record_key === anchor.recordKey)) return;

    const resolvedKey = resolveAnchorRecordKey(
      anchor.recordKey,
      oldMessages,
      messages,
    );
    if (resolvedKey === null || resolvedKey === anchor.recordKey) {
      if (import.meta.env.DEV) {
        console.warn(
          '[virtual] anchor row vanished, no bridge available',
          anchor.recordKey,
        );
      }
      currentAnchorRef.current = null;
      return;
    }

    const bridgedAnchor: TimelineAnchor = {
      ...anchor,
      recordKey: resolvedKey,
    };
    currentAnchorRef.current = bridgedAnchor;
    const scrollEl = parentRef.current;
    if (scrollEl === null) return;
    const restored = restoreAnchor(
      bridgedAnchor,
      scrollEl,
      rowVirtualizer,
      messages,
    );
    if (!restored && import.meta.env.DEV) {
      console.warn(
        '[virtual] bridged anchor restore failed',
        bridgedAnchor.recordKey,
      );
    }
  }, [messages, rowVirtualizer]);

  /** Click handler for the "Load older" button. Captures the
   *  current anchor BEFORE handing control off to the parent's
   *  loader, so even if the parent's network round-trip yields a
   *  large prepend, we have a sticky reference point to restore
   *  to once the new rows land.
   *
   *  We always do a fresh capture here rather than reading
   *  `currentAnchorRef.current`. The on-scroll ref can lag behind
   *  the virtualizer when the user issued a programmatic scroll
   *  the virtualizer hadn't yet reacted to, so a click-time
   *  capture against the live virtualizer state is more
   *  trustworthy. The on-scroll ref still feeds the upcoming
   *  R5.3.4 dynamic-height path, which has different timing. */
  const handleLoadOlder = async () => {
    if (loadingOlder) return;
    const scrollEl = parentRef.current;
    const anchor =
      scrollEl !== null
        ? captureAnchor(
            scrollEl,
            rowVirtualizer.getVirtualItems(),
            messages,
          )
        : currentAnchorRef.current;
    if (anchor !== null) {
      pendingPrependRef.current = {
        anchor,
        oldLength: messages.length,
      };
    }
    // `Promise.resolve` lets us await regardless of whether the
    // parent's `onLoadOlder` is sync or async. We don't need to
    // observe the result — the layout effect fires once `messages`
    // grows, which is the actual signal that the prepend landed.
    await Promise.resolve(onLoadOlder());
  };

  const onScroll = () => {
    const el = parentRef.current;
    if (el === null) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    // Passive capture — see comment on `currentAnchorRef`. Keeping
    // this fresh on every scroll lets later steps consume the most
    // recent anchor without having to capture at the call site.
    currentAnchorRef.current = captureAnchor(
      el,
      rowVirtualizer.getVirtualItems(),
      messages,
    );
  };

  // Derived "rendered window" key for the post-mount jump effect.
  // We need a stable scalar to depend on so the effect re-runs each
  // time the virtualizer mounts a different range; bare
  // `getVirtualItems()` returns a fresh array each render and would
  // re-fire the effect every commit (which is OK but noisy).
  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualRangeKey =
    virtualItems.length === 0
      ? 'empty'
      : `${virtualItems[0]!.index}:${virtualItems[virtualItems.length - 1]!.index}`;

  /** Brief background flash on a row, matching the plain path's
   *  highlight contract. Tailwind class so the timeline doesn't
   *  pull in a JS animation dep. */
  const flashRow = (el: HTMLElement) => {
    el.classList.add('bg-primary/15');
    setTimeout(() => el.classList.remove('bg-primary/15'), 1500);
  };

  /** Inline floating toast for the not-loaded reply-jump case.
   *  Append-and-self-remove rather than React state so it doesn't
   *  trigger a re-render of the timeline. Keep parity with the
   *  plain path's wording — the text comes from a single existing
   *  i18n key shared by both implementations. */
  const showOutOfWindowToast = (scrollEl: HTMLDivElement) => {
    const hint = document.createElement('div');
    hint.textContent = `· ${t('message_actions.reply_out_of_window')} ·`;
    hint.className =
      'absolute left-1/2 top-2 -translate-x-1/2 z-30 rounded bg-foreground/80 px-2 py-1 text-[11px] text-background pointer-events-none';
    scrollEl.appendChild(hint);
    setTimeout(() => hint.remove(), 1500);
  };

  /** Refresh the on-scroll anchor + atBottom flag after a jump.
   *  Without this, `currentAnchorRef` and `atBottomRef` still
   *  reflect the user's pre-jump position, which the saved-anchor
   *  save effect (R5.3.5) would persist on next channel switch and
   *  any subsequent prepend / dynamic-height restore would aim at.
   *  We rAF the capture so the virtualizer has time to commit the
   *  scroll delta before we re-read its virtualItems. */
  const refreshAnchorAfterJump = () => {
    atBottomRef.current = false;
    requestAnimationFrame(() => {
      const el = parentRef.current;
      if (el === null) return;
      atBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
      currentAnchorRef.current = captureAnchor(
        el,
        rowVirtualizer.getVirtualItems(),
        messagesRef.current,
      );
    });
  };

  /** Three-state reply-jump handler.
   *
   *   1. Target is already mounted: DOM-scroll + flash, refresh
   *      anchor immediately.
   *   2. Target is in `messages` but not mounted: stash a pending
   *      jump record, ask the virtualizer to scroll to the index;
   *      the post-mount layout effect below applies the flash + the
   *      anchor refresh on the first frame the target's wrapper
   *      appears.
   *   3. Target is not in `messages` at all: inline floating toast
   *      using the existing `message_actions.reply_out_of_window`
   *      i18n key. NO remote single-message fetch — paging-by-id is
   *      out of R5 scope (frozen in `project_reply_local_only`).
   */
  // spec §5 jump-to-message：锚回灌进 messages 后走与 reply-jump 相同的
  // 三态定位（已挂载/虚拟窗口外/不存在），一次性消费。
  useEffect(() => {
    if (focusMessageId === undefined) return;
    if (!messages.some((m) => m.server_message_id === focusMessageId)) return;
    const raf = requestAnimationFrame(() => {
      handleReplyJump(focusMessageId);
      // Claim initial positioning so the scroll-to-bottom effect can't
      // override the anchor (long-chat jump race; matches plain list).
      positionedForChannelRef.current = channelId;
      atBottomRef.current = false;
      onFocusConsumed?.();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, messages]);

  const handleReplyJump = (serverMessageId: string) => {
    const scrollEl = parentRef.current;
    if (scrollEl === null) return;
    // Case 1: target is mounted right now → scroll into view + flash.
    const mounted = scrollEl.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(serverMessageId)}"]`,
    );
    if (mounted !== null) {
      mounted.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashRow(mounted);
      refreshAnchorAfterJump();
      return;
    }
    // Case 2: target is in messages but virtual-windowed out → ask
    // the virtualizer to scroll there and wait for the post-mount
    // layout effect to apply the flash.
    const idx = messages.findIndex(
      (m) => m.server_message_id === serverMessageId,
    );
    if (idx >= 0) {
      pendingJumpRef.current = { serverMessageId, index: idx };
      rowVirtualizer.scrollToIndex(idx, { align: 'center' });
      return;
    }
    // Case 3: target is not in `messages` at all → inline toast.
    showOutOfWindowToast(scrollEl);
  };

  // R5.4 — post-mount highlight pass for the pending reply jump.
  //
  // `handleReplyJump` (above) sets `pendingJumpRef` when the target
  // is in `messages` but outside the rendered window, then triggers
  // `scrollToIndex`. The virtualizer reacts on the next frame(s),
  // re-rendering with a different rendered range. This effect
  // watches that range via `virtualRangeKey` and, once the target's
  // wrapper appears in the DOM, applies the flash and clears the
  // pending ref. Once-only per jump; if the target never mounts (it
  // shouldn't, since the index is in range), the pending ref hangs
  // around until the next channel switch — harmless because we only
  // act in the affirmative case.
  useLayoutEffect(() => {
    const pending = pendingJumpRef.current;
    if (pending === null) return;
    const scrollEl = parentRef.current;
    if (scrollEl === null) return;
    const target = scrollEl.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(pending.serverMessageId)}"]`,
    );
    if (target === null) return;
    pendingJumpRef.current = null;
    flashRow(target);
    refreshAnchorAfterJump();
  }, [virtualRangeKey, messages]);

  return (
    <div
      ref={parentRef}
      onScroll={onScroll}
      data-virtual-timeline="1"
      // min-h-0 is mandatory: flex items default to min-height: auto
      // which grows to fit content and defeats overflow-y-auto.
      className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
    >
      <div className="flex justify-center pb-2">
        {reachedBeginning ? (
          <span className="text-xs text-muted-foreground">{t('panel.beginning')}</span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void handleLoadOlder();
            }}
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

      {messages.length > 0 && (
        <div
          // Total content height is dictated by the virtualizer; the
          // inner rows are absolute-positioned at their virtual
          // offset. `position: relative` is required for the
          // absolute children to anchor against this box.
          // `data-virtual-root` is the lookup key the anchor
          // primitives use to translate scrollEl coordinates into
          // virtualItem coordinates (the virtual area starts below
          // any chrome we render above it, e.g. the load-older chip).
          data-virtual-root="1"
          style={{
            height: rowVirtualizer.getTotalSize(),
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualItem) => {
            const m = messages[virtualItem.index];
            if (m === undefined) return null;
            const replyVm =
              m.reply_to !== undefined
                ? messages.find((x) => x.server_message_id === m.reply_to)
                : undefined;
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                // R5.3.4: the record_key is the lookup our wrapped
                // `measureElement` uses to track each row's last-known
                // height. The virtualizer's own `key` is opaque, so we
                // surface it in the DOM directly.
                data-record-key={m.record_key}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                // Tailwind doesn't let us merge through styles for
                // `space-y-2` to apply across virtual children, so
                // each row carries its own bottom padding instead.
                className="pb-2"
              >
                <MessageRow
                  vm={m}
                  peerReadPts={peerReadPts}
                  channelId={channelId}
                  peerName={peerName}
                  selfUid={selfUid}
                  replyVm={replyVm}
                  onReply={() => onReply(m)}
                  onForward={onForward === undefined ? undefined : () => onForward(m)}
                  onJumpToReply={handleReplyJump}
                  canPin={canPin}
                  pinnedIds={pinnedIds}
                  onTogglePin={onTogglePin}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

