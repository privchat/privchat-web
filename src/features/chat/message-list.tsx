// MessageList — the entry seam for the timeline. Picks between the
// plain (R5.1) and virtualized (R5.2+) implementations based on the
// `VITE_PRIVCHAT_VIRTUAL_TIMELINE` build-time flag. Default is OFF:
// the plain path remains the production code path until the
// virtualizer has bedded in.
//
// The chooser deliberately lives at the call boundary, not inside
// each implementation. That way `PlainMessageList` and
// `VirtualMessageList` remain independent files — no flag noise
// inside either — and dead-code elimination can drop the disabled
// branch when the flag is resolved at build time.
//
// Both implementations consume the same `MessageListProps` shape,
// so swapping the flag at build time requires no upstream changes
// in `ConversationPanel`.

import type { MessageItemVM } from '@privchat/react';
import { PlainMessageList } from './plain-message-list';
import { VirtualMessageList } from './virtual-message-list';
import { isVirtualTimelineEnabled } from './use-virtual-timeline-enabled';

export interface MessageListProps {
  messages: MessageItemVM[];
  channelId: string;
  selfUid: string | undefined;
  peerReadPts: string | undefined;
  /** Display name for the OTHER party (direct chats only). Threaded
   *  into MessageRow for the revoke placeholder; undefined for groups. */
  peerName?: string;
  isOpening: boolean;
  reachedBeginning: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onReply: (vm: MessageItemVM) => void;
}

export function MessageList(props: MessageListProps) {
  if (isVirtualTimelineEnabled()) {
    return <VirtualMessageList {...props} />;
  }
  return <PlainMessageList {...props} />;
}
