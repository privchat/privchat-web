// Per-channel scroll-position memory. Stores the `server_message_id`
// of the row that was visible at the top of the viewport when the
// user last switched away — restoring that row's position on return
// is far more robust than restoring a raw `scrollTop` (which breaks
// when bubble heights shift: lazy-loaded images, reaction chips
// appearing, revoked-message collapse, etc).
//
// Module-level (session-scoped). Persisting across reloads would mean
// IDB writes on every scroll, which is a lot of write amplification
// for a feature whose value drops sharply across a hard refresh — so
// we deliberately don't persist. If session-survival becomes a
// requirement later, the API surface stays compatible: a
// `loadFromCache()` / `saveToCache()` pair could wrap this.
//
// R7.1 namespacing: each anchor lives under
// `<accountKey>:<channelId>`, where `accountKey` is read from the
// active-account seam. Today there's exactly one account, so every
// entry lands in the legacy-default bucket and behavior is identical
// to pre-R7. Once R7.2 migrates to a real `AccountKey`, switching
// accounts (R7.3) implicitly picks the right bucket without any
// change to call sites.

import { getActiveAccountKey } from '@/lib/active-account';

export interface ScrollAnchor {
  /** server_message_id of the row that should align with the top of
   *  the viewport on restore. Undefined when the user is at the very
   *  bottom (we treat that as "stick to bottom" semantics rather than
   *  a fixed anchor). */
  messageId?: string;
  /** Distance in px from the row's top to the viewport top at save
   *  time. Used as a fine-tune offset on restore so we land on the
   *  same scroll position, not just on the row. */
  offsetFromTop: number;
  /** Was the user visibly at the bottom when leaving? If so, restore
   *  to bottom regardless of `messageId`. */
  atBottom: boolean;
}

const positions = new Map<string, ScrollAnchor>();

function plainKey(channelId: string): string {
  return `${getActiveAccountKey()}:${channelId}`;
}

export function saveScrollAnchor(channelId: string, anchor: ScrollAnchor): void {
  positions.set(plainKey(channelId), anchor);
}

export function loadScrollAnchor(channelId: string): ScrollAnchor | undefined {
  return positions.get(plainKey(channelId));
}

export function clearScrollAnchor(channelId: string): void {
  positions.delete(plainKey(channelId));
}

// ---------------- Virtual timeline (R5.3.5) ----------------
//
// The virtual list anchors on `record_key` instead of `server_message_id`
// because (a) pending rows have no server id yet, and (b) the
// virtualizer's scrollToIndex contract resolves an index from the
// current `messages` array — `record_key` is what `MessageItemVM`
// already carries as the stable per-row identity. Adding `recordKey`
// as a new field on `ScrollAnchor` would risk plain ↔ virtual
// cross-contamination if a user toggles the flag mid-session, so the
// two paths use parallel storage Maps. Module-level / session-scoped
// just like the plain Map; same persistence trade-off applies.

export interface VirtualScrollAnchor {
  /** Stable per-row identity (`MessageItemVM.record_key`). When the
   *  user comes back to this channel, we look this key up in the
   *  current messages array and call `restoreAnchor` to land at
   *  `offsetFromTop` inside that row. */
  recordKey: string;
  /** Signed pixel offset from the row's top to the viewport's top
   *  edge at save time. Same semantics as `TimelineAnchor.offsetFromTop`
   *  in `virtual-anchor.ts` — see that file for the sign convention. */
  offsetFromTop: number;
}

const virtualPositions = new Map<string, VirtualScrollAnchor>();

function virtualKey(channelId: string): string {
  return `${getActiveAccountKey()}:${channelId}`;
}

export function saveVirtualScrollAnchor(
  channelId: string,
  anchor: VirtualScrollAnchor,
): void {
  virtualPositions.set(virtualKey(channelId), anchor);
}

export function loadVirtualScrollAnchor(
  channelId: string,
): VirtualScrollAnchor | undefined {
  return virtualPositions.get(virtualKey(channelId));
}

export function clearVirtualScrollAnchor(channelId: string): void {
  virtualPositions.delete(virtualKey(channelId));
}
