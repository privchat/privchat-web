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
  /** Opens the forward picker for this message; item hidden when absent. */
  onForward?: (vm: MessageItemVM) => void;
  /** Group-only: whether the current user (owner/admin) may pin messages.
   *  Undefined / false for direct chats and regular members — the pin
   *  menu item stays hidden. */
  canPin?: boolean;
  /** Group-only: owner/admin may revoke others' messages. */
  canRevokeOthers?: boolean;
  /** Group-only: uid → role for sender-name tags. */
  roleByUid?: Map<string, string>;
  /** Group-only: set of `server_message_id`s currently pinned. Drives the
   *  Pin/Unpin menu-item label toggle. */
  pinnedIds?: Set<string>;
  /** 群聊标记:对方消息气泡上方显示发送者昵称(微信/Telegram 惯例)。 */
  isGroup?: boolean;
  /** Group-only: toggle pin state for a row. Resolves after the pinned
   *  list has been refreshed so the menu label + pinned bar stay in sync. */
  onTogglePin?: (vm: MessageItemVM) => Promise<void>;
  /** spec §5 跳转锚（server_message_id）：消息就绪后滚动定位 + 高亮，一次性消费。 */
  focusMessageId?: string;
  /** 定位完成（或确认锚不在集合中）后回调，父层清 state。 */
  onFocusConsumed?: () => void;
}

export function MessageList(props: MessageListProps) {
  if (isVirtualTimelineEnabled()) {
    return <VirtualMessageList {...props} />;
  }
  return <PlainMessageList {...props} />;
}
