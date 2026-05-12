// Find Friend dialog. The search is server-driven (`accountSearch`),
// debounced ~250ms so we don't fire a query per keystroke. Each result
// row carries an Add button — disabled if the user is already a friend
// or if a request is already in flight. We track applied uids in local
// state so users see immediate feedback without re-querying.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search } from 'lucide-react';
import type { SearchedUser } from '@privchat/sdk';
import { useAccountSearch, useFriendApply } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { captureException } from '@/lib/error-reporter';
import { Avatar } from './avatar';
import { errorText } from './error-text';

const DEBOUNCE_MS = 250;

export function ContactFindDialog({
  open,
  onOpenChange,
  onOpenChat,
  openingUid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Invoked when the user taps Chat on an already-friend row. The
   *  dialog dispatches and closes itself; ChatWorkspace handles the
   *  actual `channelDirectGetOrCreate` + tab switch. */
  onOpenChat: (user_id: string) => void;
  /** Mirrors ChatWorkspace's `openingDirectUid` debounce so we disable
   *  Chat buttons while a previous tap is still in flight. */
  openingUid: string | null;
}) {
  const { t } = useTranslation();
  const search = useAccountSearch();
  const apply = useFriendApply();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchedUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [applyingUid, setApplyingUid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  // Reset state every time the dialog opens — stale results from a
  // previous session are confusing.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setApplied(new Set());
    setApplyingUid(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed === '') {
      setResults([]);
      setSearching(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setSearching(true);
    setError(null);
    const timer = setTimeout(() => {
      search(trimmed)
        .then((resp) => {
          // Late-arriving response: drop if a newer query has been issued.
          if (reqId !== reqIdRef.current) return;
          setResults(resp.users);
        })
        .catch((e: unknown) => {
          if (reqId !== reqIdRef.current) return;
          captureException(e, { source: 'contact-find.search' });
          setError(errorText(e));
        })
        .finally(() => {
          if (reqId === reqIdRef.current) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, search]);

  const handleApply = async (user: SearchedUser) => {
    if (applyingUid !== null) return;
    setApplyingUid(user.user_id);
    setError(null);
    try {
      // Server requires both source AND source_id (10100 otherwise),
      // and source must be one of {search, group, card_share, friend}.
      // `search_session_id` is the token the server issued for this
      // search row; it's a u64 snowflake and the SDK normalises it to
      // a string so we don't lose precision in JSON.parse.
      await apply(user.user_id, undefined, 'search', user.search_session_id);
      setApplied((prev) => new Set(prev).add(user.user_id));
    } catch (e) {
      captureException(e, { source: 'contact-find.apply' });
      setError(errorText(e));
    } finally {
      setApplyingUid(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('contacts.find_title')}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder={t('contacts.find_placeholder')}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            className="pl-9"
          />
        </div>
        {error !== null && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="max-h-[60vh] overflow-y-auto">
          {searching && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!searching && query.trim() !== '' && results.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t('contacts.find_no_results')}
            </div>
          )}
          <ul className="divide-y">
            {results.map((user) => {
              const display = user.nickname || user.username;
              const alreadyFriend = user.is_friend;
              const isApplied = applied.has(user.user_id);
              const isApplying = applyingUid === user.user_id;
              const userIdStr = String(user.user_id);
              const isOpening = openingUid === userIdStr;
              return (
                <li key={user.user_id} className="flex items-center gap-3 py-2">
                  <Avatar
                    seed={`u:${user.user_id}`}
                    label={display}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{display}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      @{user.username}
                    </div>
                  </div>
                  {alreadyFriend ? (
                    <Button
                      size="sm"
                      disabled={openingUid !== null}
                      onClick={() => {
                        onOpenChat(userIdStr);
                        onOpenChange(false);
                      }}
                    >
                      {isOpening ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        t('contacts.chat')
                      )}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={isApplied ? 'secondary' : 'default'}
                      disabled={isApplied || applyingUid !== null}
                      onClick={() => void handleApply(user)}
                    >
                      {isApplying ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isApplied ? (
                        t('contacts.applied')
                      ) : (
                        t('contacts.apply')
                      )}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
