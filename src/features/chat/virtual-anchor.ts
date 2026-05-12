// R5.3.1 — anchor primitives for the virtualized timeline.
//
// The whole point of an anchor model (vs raw `scrollTop`) is that
// the virtualizer can prepend / re-measure / replace rows under us
// at any moment, and a pixel-only position becomes meaningless the
// instant heights or indices shift. An anchor pins to a specific
// row by `record_key` and remembers where INSIDE that row the
// viewport top was sitting. Restoring then reduces to:
//   - find the row by recordKey in the new array
//   - scroll so the viewport top lands at the same in-row offset
//
// This file is intentionally low-level: pure functions that take
// the data they need and return small results. R5.3.2 onwards wire
// these into history-prepend, dynamic-height, and channel-switch
// flows; R5.3.1 only adds passive `captureAnchor` on scroll so the
// primitive is exercised on real virtualizer state without yet
// changing user-visible behavior.
//
// See docs/VIRTUAL_TIMELINE_DESIGN.md for the broader strategy.

import type { VirtualItem } from '@tanstack/react-virtual';
import type { MessageItemVM } from '@privchat/react';

export interface TimelineAnchor {
  /** Stable per-row identity (`MessageItemVM.record_key`). Survives
   *  local-echo → ACK in-place swaps because that's how `record_key`
   *  is defined; for cross-version safety though, also consult
   *  {@link resolveAnchorRecordKey} when the original key has gone
   *  missing in a re-projection. */
  recordKey: string;
  /** Signed pixel offset from the row's top to the viewport's top
   *  edge at the moment of capture, measured in the virtualizer's
   *  coordinate space (i.e. with any chrome above the virtual area
   *  already subtracted out).
   *
   *  - Positive → user has scrolled `n` pixels INTO the row's body
   *    from its top.
   *  - Zero → row's top is flush with the viewport top.
   *  - Negative → row's top is `n` pixels BELOW the viewport top
   *    (i.e. the chrome above the virtual area is occupying the
   *    top of the viewport). Common at scrollTop=0.
   *
   *  Restoring at the same `offsetFromTop` reproduces the same
   *  visual position the user was looking at, regardless of
   *  measurements drifting under us. */
  offsetFromTop: number;
}

/** Subset of the @tanstack/react-virtual `Virtualizer` we touch.
 *  Typed structurally so this module doesn't have to commit to a
 *  specific `<TScrollElement, TItemElement>` parameterisation —
 *  callers can pass any virtualizer instance whose `scrollToIndex`
 *  matches the documented contract. */
export interface AnchorVirtualizer {
  scrollToIndex: (
    index: number,
    options?: {
      align?: 'start' | 'center' | 'end' | 'auto';
      behavior?: 'auto' | 'smooth';
    },
  ) => void;
  /** R5.3.5: read the post-scroll item map so the rAF tail can compute
   *  target `scrollTop` deterministically. Without this, the tail had
   *  to do `scrollTop += offset`, which is non-idempotent — two
   *  back-to-back calls (e.g. React Strict Mode's double-mount cycle
   *  hitting restoreAnchor twice) each add `virtualRootOffset`,
   *  doubling the chrome compensation. */
  getVirtualItems: () => ReadonlyArray<VirtualItem>;
}

/** Locate the topmost virtual row whose pixel range the viewport
 *  top intersects, and return an anchor pinning that row + the
 *  in-row offset. Returns `null` when the list is empty or when
 *  the virtual area can't be located in `scrollEl` (typically a
 *  too-early call before mount has positioned the rows).
 *
 *  The virtual area is identified by its `[data-virtual-root="1"]`
 *  attribute; absolute-positioned virtual children are siblings of
 *  whatever chrome the surrounding component places above (e.g.
 *  the "load older" header chip), so we have to subtract that
 *  chrome's height before comparing to `virtualItem.start`. */
export function captureAnchor(
  scrollEl: HTMLElement,
  virtualItems: ReadonlyArray<VirtualItem>,
  messages: ReadonlyArray<MessageItemVM>,
): TimelineAnchor | null {
  if (virtualItems.length === 0) return null;
  const root = scrollEl.querySelector<HTMLElement>('[data-virtual-root="1"]');
  if (root === null) return null;
  const virtualRootOffset = offsetTopWithin(root, scrollEl);
  const adjustedScrollTop = scrollEl.scrollTop - virtualRootOffset;
  // Items are ordered by index/start, so a single forward pass
  // gives us the last item with `start <= adjustedScrollTop`.
  // That is the topmost row whose top edge is at or above the
  // viewport top — i.e. the row the user is currently looking at.
  let candidate: VirtualItem | undefined;
  for (const vi of virtualItems) {
    if (vi.start <= adjustedScrollTop) candidate = vi;
    else break;
  }
  // Edge case: the user has scrolled into the chrome above the
  // virtual area (e.g. they're staring at the "load older" chip),
  // so no virtual item starts at or before the viewport top.
  // Anchor on the first virtual item; the resulting `offsetFromTop`
  // is negative (= "row is below viewport top by N pixels"), which
  // restoreAnchor handles correctly.
  const chosen = candidate ?? virtualItems[0];
  if (chosen === undefined) return null;
  const message = messages[chosen.index];
  if (message === undefined) return null;
  const offsetFromTop = adjustedScrollTop - chosen.start;
  return { recordKey: message.record_key, offsetFromTop };
}

/** Restore the viewport to the row identified by `anchor`. Returns
 *  `true` when the row was found in `messages` and the restore was
 *  scheduled, `false` when the recordKey has no current mapping
 *  (caller decides whether to fall back to bottom / no-op).
 *
 *  Implementation notes:
 *  - `scrollToIndex(idx, 'start')` parks `scrollEl.scrollTop` at
 *    `items[idx].start`, which is the row's offset measured in the
 *    virtualizer's coordinate space. The virtualizer doesn't know
 *    about chrome rendered above the virtual area (the load-older
 *    chip, padding, etc.), so we have to add `virtualRootOffset`
 *    on top to land the row at the same scrollEl-coord position
 *    the capture was relative to. Without this addition, the
 *    restore systematically pulls the user upward by exactly the
 *    chrome height every time.
 *  - The corrections are applied in a double-rAF chain so the
 *    virtualizer has time to measure newly-mounted rows after
 *    `scrollToIndex` (single-rAF can race the measurement pass).
 *  - The rAF tail computes the target `scrollTop` *deterministically*
 *    from the virtualizer's post-scroll item map, NOT by reading the
 *    current `scrollEl.scrollTop` and adding to it. The deterministic
 *    formulation makes the tail idempotent: two back-to-back restore
 *    calls (e.g. React Strict Mode's double-mount cycle hitting the
 *    R5.3.5 saved-anchor restore twice) settle on the same final
 *    `scrollTop`. The earlier `scrollTop +=` form accidentally added
 *    `virtualRootOffset` once per call, doubling the chrome shift on
 *    the second call. */
export function restoreAnchor(
  anchor: TimelineAnchor,
  scrollEl: HTMLElement,
  virtualizer: AnchorVirtualizer,
  messages: ReadonlyArray<MessageItemVM>,
): boolean {
  const idx = messages.findIndex((m) => m.record_key === anchor.recordKey);
  if (idx < 0) return false;
  const root = scrollEl.querySelector<HTMLElement>('[data-virtual-root="1"]');
  const virtualRootOffset =
    root !== null ? offsetTopWithin(root, scrollEl) : 0;
  virtualizer.scrollToIndex(idx, { align: 'start' });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const item = virtualizer
        .getVirtualItems()
        .find((vi) => vi.index === idx);
      // Defensive: scrollToIndex didn't manage to bring the row into
      // the rendered window (extreme edge case — should never happen
      // when the row is in `messages`). Fall back to the previous
      // additive formulation so the restore at least lands close.
      if (item === undefined) {
        scrollEl.scrollTop =
          scrollEl.scrollTop + virtualRootOffset + anchor.offsetFromTop;
        return;
      }
      scrollEl.scrollTop =
        item.start + virtualRootOffset + anchor.offsetFromTop;
    });
  });
  return true;
}

/** Map an anchor's `recordKey` from a previous `messages` snapshot
 *  to the equivalent row in a new snapshot. Handles the local-echo
 *  → server-ACK case where `record_key` flips from
 *  `local:<local_message_id>` to `<server_message_id>` in place.
 *
 *  Lookup order:
 *    1. The same key still exists → no remap needed.
 *    2. Match by `local_message_id` (pending → ACKed swap).
 *    3. Match by `server_message_id` (the rare reverse — server
 *       row appears with a fresh local id we hadn't seen).
 *
 *  Returns `null` when the row has genuinely vanished (e.g. the
 *  user discarded a failed outbox entry while reading history). */
export function resolveAnchorRecordKey(
  oldKey: string,
  oldMessages: ReadonlyArray<MessageItemVM>,
  newMessages: ReadonlyArray<MessageItemVM>,
): string | null {
  if (newMessages.some((m) => m.record_key === oldKey)) return oldKey;
  const oldVm = oldMessages.find((m) => m.record_key === oldKey);
  if (oldVm === undefined) return null;
  if (oldVm.local_message_id !== undefined) {
    const hit = newMessages.find(
      (m) => m.local_message_id === oldVm.local_message_id,
    );
    if (hit !== undefined) return hit.record_key;
  }
  if (oldVm.server_message_id !== undefined) {
    const hit = newMessages.find(
      (m) => m.server_message_id === oldVm.server_message_id,
    );
    if (hit !== undefined) return hit.record_key;
  }
  return null;
}

/** Walk up the `offsetParent` chain from `el`, summing offsets
 *  until we reach (or pass) `ancestor`. Falls back to a
 *  bounding-rect computation when `el` isn't actually inside
 *  `ancestor` (defensive — shouldn't happen in practice). */
function offsetTopWithin(el: HTMLElement, ancestor: HTMLElement): number {
  let total = 0;
  let cursor: HTMLElement | null = el;
  while (cursor !== null && cursor !== ancestor) {
    total += cursor.offsetTop;
    cursor = cursor.offsetParent as HTMLElement | null;
  }
  if (cursor === ancestor) return total;
  // Fallback: rect-based delta. Less precise across transformed
  // ancestors, but works when the offsetParent chain misses.
  return el.getBoundingClientRect().top - ancestor.getBoundingClientRect().top + ancestor.scrollTop;
}
