// Global message-history search (MESSAGE_HISTORY spec §4/§7). Cloud search
// over the caller's visible channels. The debounce (400ms), <2-char skip,
// stale-response drop (request-id), cursor paging and terminal error state
// all live in @privchat/react's shared `useMessageSearchState` — the single
// cross-client (web/h5/App) search state machine — so this dialog only wires
// that state to the UI. Hits are snippet projections and are never written
// into the message cache; picking one asks ChatWorkspace to open the channel
// anchored at the matched message (jump-to-message, spec §5).

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search } from 'lucide-react';
import type { MessageHistorySearchHit } from '@privchat/sdk';
import { useChannelList, useMessageSearchState } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Render a snippet with its first server-computed highlight range tinted.
 *  Ranges are char offsets; out-of-bounds (astral chars) degrades gracefully
 *  to the plain snippet. */
function SnippetLine({ hit }: { hit: MessageHistorySearchHit }) {
  const range = hit.highlight_ranges[0];
  if (range === undefined) {
    return <span className="text-muted-foreground">{hit.snippet}</span>;
  }
  const chars = Array.from(hit.snippet);
  const [start, end] = range;
  if (start < 0 || end > chars.length || start >= end) {
    return <span className="text-muted-foreground">{hit.snippet}</span>;
  }
  return (
    <span className="text-muted-foreground">
      {chars.slice(0, start).join('')}
      <span className="text-primary">{chars.slice(start, end).join('')}</span>
      {chars.slice(end).join('')}
    </span>
  );
}

export function MessageSearchDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open `channel_id` anchored at `message_id` (server snowflake, as string
   *  to survive Number precision). */
  onPick: (channelId: string, channelType: number, messageId: string) => void;
}) {
  const { t } = useTranslation();
  const { conversations } = useChannelList({ skipAutoBootstrap: true });
  const channelInfo = useMemo(() => {
    const m = new Map<string, { title: string; channelType: number }>();
    for (const c of conversations)
      m.set(c.channel_id, { title: c.title, channelType: c.channel_type });
    return m;
  }, [conversations]);

  // Shared search state machine owns query + result/loading/error lifecycle.
  const s = useMessageSearchState();

  // Reset on each open (false→true); the hook clears query and results.
  useEffect(() => {
    if (!open) return;
    s.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('workspace.msg_search_title')}</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={s.query}
            onChange={(e) => s.setQuery(e.target.value)}
            placeholder={t('workspace.msg_search_placeholder')}
            className="pl-8"
          />
        </div>

        <div className="max-h-80 overflow-y-auto">
          {s.searching && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {s.error && (
            <p className="py-6 text-center text-sm text-destructive">
              {t('workspace.msg_search_error')}
            </p>
          )}
          {!s.searching && s.searched && !s.error && s.hits.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('workspace.msg_search_empty')}
            </p>
          )}
          <ul className="divide-y">
            {s.hits.map((hit) => (
              <li key={`${hit.channel_id}:${hit.message_id}`}>
                <button
                  type="button"
                  className="w-full px-2 py-2.5 text-left hover:bg-accent"
                  onClick={() => {
                    const info = channelInfo.get(String(hit.channel_id));
                    if (info !== undefined) {
                      onPick(String(hit.channel_id), info.channelType, String(hit.message_id));
                    }
                  }}
                >
                  <div className="truncate text-sm font-medium">
                    {channelInfo.get(String(hit.channel_id))?.title ?? String(hit.channel_id)}
                  </div>
                  <div className="truncate text-xs">
                    <SnippetLine hit={hit} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {s.nextCursor !== null && s.hits.length > 0 && (
            <div className="py-2 text-center">
              <Button size="sm" variant="ghost" onClick={s.loadMore} disabled={s.loadingMore}>
                {s.loadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('workspace.msg_search_load_more')
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
