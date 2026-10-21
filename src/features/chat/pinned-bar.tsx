import { useState } from 'react';
// PinnedBar — the group-chat pinned-messages strip. Renders between the
// conversation header and the message timeline for group chats only.
//
// Data flow: ConversationPanel owns the pinned list (fetched via
// `useGroupOps().pinnedMessages`) and the per-conversation `messages`
// snapshot. We don't fetch original message bodies here — if the pinned
// message is in the loaded window we show a short content preview;
// otherwise a generic placeholder. Opening delegates context hydration to the panel.
//
// Owners/admins (`canPin`) get an explicitly labeled per-row unpin button that calls back
// into the panel's toggle handler. Regular members see a read-only list.

import { useTranslation } from 'react-i18next';
import type { MessageItemVM } from '@privchat/react';
import type { PinnedMessageItem } from '@privchat/sdk';

export interface PinnedBarProps {
  /** Pinned items as returned by `useGroupOps().pinnedMessages`. */
  items: PinnedMessageItem[];
  /** Current conversation window — used to resolve a content preview by
   *  matching `server_message_id` against each pinned `message_id`. */
  messages: MessageItemVM[];
  /** Owner/admin gate. When true each row shows an unpin button. */
  canManage: boolean;
  /** Unpin a single message (owner/admin only). */
  onUnpin: (messageId: string) => Promise<void>;
  onOpen: (messageId: string) => void;
}

export function PinnedBar({
  items,
  messages,
  canManage,
  onUnpin,
  onOpen,
}: PinnedBarProps) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(false);
  if (items.length === 0 || hidden) return null;

  return (
    <div className="shrink-0 border-b bg-muted/30">
      <button type="button" className="float-right px-3 py-1" aria-label={t('groups.pinned_bar_title')} onClick={() => setHidden(true)}>×</button>
      {items.map((item) => {
        const messageId = String(item.message_id);
        const vm = messages.find((m) => m.server_message_id === messageId);
        const preview =
          vm === undefined
            ? undefined
            : vm.body.text !== ''
              ? vm.body.text
              : `[${vm.content_type}]`;
        return (
          <div
            key={messageId}
            className="flex items-center gap-2 px-3 py-1.5 text-xs"
          >
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(messageId)}>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span aria-hidden>📌</span>
                <span>{t('groups.pinned_bar_title')}</span>
              </div>
              {preview !== undefined && (
                <div className="truncate text-muted-foreground">{preview}</div>
              )}
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => void onUnpin(messageId)}
                className="shrink-0 rounded p-1 hover:bg-accent"
                aria-label={t('message_actions.unpin')}
                title={t('message_actions.unpin')}
              >
                {t('message_actions.unpin')}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
