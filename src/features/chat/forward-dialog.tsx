// Forward picker: multi-select conversations (DMs + groups) and forward a
// source message into each — app-parity with ForwardPickerPage (multi-target,
// per-target failure collection). Delivery uses the SDK's forwardMessage
// (Rust forward_message parity: a fresh copy per target, not a reference).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChannelList, usePrivchatClient } from '@privchat/react';
import type { MessageItemVM } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar } from './avatar';
import { GroupAvatar } from './group-avatar';
import { errorText } from './error-text';

export function ForwardDialog({
  source,
  sourceChannelId,
  sourceChannelType,
  onClose,
}: {
  /** Message being forwarded; dialog is closed when null. */
  source: MessageItemVM | null;
  sourceChannelId: string;
  sourceChannelType: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = usePrivchatClient();
  const { records } = useChannelList({ skipAutoBootstrap: true });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records
      .filter((c) => c.channel_type === 1 || c.channel_type === 2)
      .filter((c) => q === '' || (c.title ?? c.channel_id).toLowerCase().includes(q));
  }, [records, query]);

  const key = (c: { channel_id: string; channel_type: number }) =>
    `${c.channel_id}:${c.channel_type}`;

  const toggle = (k: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setQuery('');
    setFailures([]);
    setSending(false);
  };

  const onSend = async () => {
    if (source?.server_message_id === undefined || selected.size === 0 || sending) return;
    setSending(true);
    const selfUid = client.sessionSnapshot().user_id ?? '';
    const failed: string[] = [];
    for (const c of targets) {
      if (!selected.has(key(c))) continue;
      try {
        await client.forwardMessage({
          source_channel_id: sourceChannelId,
          source_channel_type: sourceChannelType,
          source_server_message_id: source.server_message_id,
          target_channel_id: c.channel_id,
          target_channel_type: c.channel_type,
          from_uid: selfUid,
        });
      } catch (e) {
        failed.push(`${c.title ?? c.channel_id}: ${errorText(e)}`);
      }
    }
    if (failed.length === 0) {
      reset();
      onClose();
      return;
    }
    setFailures(failed);
    setSending(false);
  };

  return (
    <Dialog
      open={source !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('forward.title')}</DialogTitle>
        </DialogHeader>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('forward.search_placeholder')}
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="max-h-64 overflow-y-auto -mx-1">
          {targets.length === 0 && (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t('forward.empty')}
            </div>
          )}
          {targets.map((c) => {
            const k = key(c);
            const checked = selected.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggle(k)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <input type="checkbox" readOnly checked={checked} className="accent-primary" />
                {c.channel_type === 2 ? (
                  <GroupAvatar
                    channelId={c.channel_id}
                    name={c.title ?? c.channel_id}
                    size="sm"
                  />
                ) : (
                  <Avatar
                    seed={c.peer_user_id ?? c.channel_id}
                    label={c.title ?? c.channel_id}
                    userId={c.peer_user_id}
                    size="sm"
                  />
                )}
                <span className="truncate">{c.title ?? c.channel_id}</span>
              </button>
            );
          })}
        </div>
        {failures.length > 0 && (
          <div className="max-h-20 overflow-y-auto text-xs text-destructive">
            {t('forward.partial_failed')}
            <ul className="list-disc pl-4">
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
          >
            {t('forward.cancel')}
          </button>
          <button
            type="button"
            disabled={selected.size === 0 || sending}
            onClick={() => void onSend()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {sending
              ? t('forward.sending')
              : t('forward.send', { count: selected.size })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
