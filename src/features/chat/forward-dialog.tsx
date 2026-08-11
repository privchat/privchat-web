// Forward picker: multi-select conversations (DMs + groups) and forward a
// source message into each — app-parity with ForwardPickerPage (multi-target,
// per-target failure collection).
//
// 🔴 转发不是一种消息，也没有 forward RPC：它就是**用户以自己的身份把同一份内容
// 再发一次**，走的是普通发送。附件之所以不重传字节，是上传预检按内容摘要命中的
// （sha256 → already_exists → claim），跟这里的发送路径无关。
//
// 因此媒体转发要先把明文取回来（downloadAttachmentBlob = get_url + 解密），再走
// 和用户手选文件完全相同的 sendImage / sendVideo / sendFile。
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
    const failed: string[] = [];
    for (const c of targets) {
      if (!selected.has(key(c))) continue;
      try {
        await resend(client, source, c.channel_id, c.channel_type);
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

/**
 * 把一条消息按类型重新发一次。
 *
 * 文本原样重发；媒体取回明文后走普通发送——秒传由上传预检负责，这里不需要知道。
 * 红包/转账/系统消息重发一次没有意义，直接拒绝，而不是发出一条别人点不动的卡片。
 */
async function resend(
  client: ReturnType<typeof usePrivchatClient>,
  source: MessageItemVM,
  channelId: string,
  channelType: number,
): Promise<void> {
  const body = source.body;
  if (body.kind === 'text') {
    const text = body.text.trim();
    if (text === '') throw new Error('empty message');
    await client.sendTextMessage({
      channel_id: channelId,
      channel_type: channelType,
      from_uid: source.from_uid,
      content: text,
    });
    return;
  }

  const meta = 'metadata' in body ? body.metadata : undefined;
  if (meta === undefined || !('file_id' in meta) || meta.file_id === undefined) {
    throw new Error(`cannot resend a ${body.kind} message`);
  }

  // 取回明文：服务端存的是密文，直接把 file_url 转手给发送接口是发不出去的。
  const blob = await client.downloadAttachmentBlob(meta.file_id);
  const filename = ('file_name' in meta && meta.file_name) || fallbackName(meta.type);
  const mime = blob.type !== '' ? blob.type : guessMime(filename);
  const caption = body.text === '' ? undefined : body.text;
  const common = {
    channel_id: channelId,
    channel_type: channelType,
    file: blob,
    filename,
    mime_type: mime,
    caption,
  };

  if (meta.type === 'image') {
    await client.sendImage({ ...common, width: meta.width ?? 0, height: meta.height ?? 0 });
    return;
  }
  if (meta.type === 'video') {
    await client.sendVideo({
      ...common,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      duration: meta.duration ?? 0,
    });
    return;
  }
  // voice / file 都按普通文件发：Web 没有语音录制入口，转发一条语音等价于转发它的文件。
  await client.sendFile(common);
}

function fallbackName(type: string): string {
  if (type === 'image') return 'image.jpg';
  if (type === 'video') return 'video.mp4';
  if (type === 'voice') return 'voice.m4a';
  return 'file.bin';
}

function guessMime(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    pdf: 'application/pdf',
  };
  return table[ext] ?? 'application/octet-stream';
}
