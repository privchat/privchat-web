// Reaction chip row + emoji picker for a single message. Mounted under
// the message bubble. Only fetches when there's a server_message_id
// (skipping pending rows). Add/remove are optimistic-ish: we await the
// RPC + the refetch the hook fires internally, no local-state mirror.
//
// Picker is a tiny inline popover, not a full emoji index — chat UX
// favors a "common 8" tray; users can pick from the keyboard's emoji
// menu via copy-paste if they want something esoteric. Picking an
// emoji the user has already reacted with REMOVES it (toggle).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessageReactions } from '@privchat/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { errorText } from './error-text';

const COMMON_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥'] as const;

export function MessageReactions({
  serverMessageId,
  selfUid,
  isSelf,
}: {
  serverMessageId: string | undefined;
  selfUid: string | undefined;
  isSelf: boolean;
}) {
  const { add, remove, reactions } = useMessageReactions(serverMessageId);
  const entries = Object.entries(reactions).filter(([, uids]) => uids.length > 0);
  if (entries.length === 0 && serverMessageId === undefined) return null;
  const selfNum = selfUid !== undefined ? Number(selfUid) : NaN;

  const toggle = async (emoji: string) => {
    try {
      const has = reactions[emoji]?.includes(selfNum) === true;
      if (has) await remove(emoji);
      else await add(emoji);
    } catch (e) {
      // best-effort UX hint; not worth a heavy banner
      // eslint-disable-next-line no-alert
      alert(errorText(e));
    }
  };

  return (
    <div
      className={cn(
        'mt-1 flex flex-wrap items-center gap-1',
        isSelf ? 'justify-end' : 'justify-start',
      )}
    >
      {entries.map(([emoji, uids]) => {
        const mine = uids.includes(selfNum);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => void toggle(emoji)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
              mine
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border bg-muted text-muted-foreground hover:bg-accent',
            )}
            title={uids.length > 1 ? `${uids.length}` : undefined}
          >
            <span>{emoji}</span>
            {uids.length > 1 && <span className="font-mono">{uids.length}</span>}
          </button>
        );
      })}
      {serverMessageId !== undefined && (
        <ReactionPicker onPick={(e) => void toggle(e)} />
      )}
    </div>
  );
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('message_actions.react')}
          title={t('message_actions.react')}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-muted-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
        >
          ☺
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="flex gap-1 p-1">
        {COMMON_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => {
              setOpen(false);
              onPick(e);
            }}
            className="rounded p-1 text-base hover:bg-accent"
          >
            {e}
          </button>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
