// React bindings for the media-send store.
//   - `useChannelMediaSends` subscribes to the in-flight entries for a
//     channel (stable array identity when unchanged).
//   - `useMediaSender` runs upload+send for a fresh send and for retry,
//     driving the store through uploading → (removed | failed).

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { usePrivchatClient } from '@privchat/react';
import {
  createEntry,
  getEntry,
  listChannel,
  markFailed,
  markUploading,
  removeEntry,
  subscribe,
  type MediaSendEntry,
  type MediaSendInputs,
} from './media-send-store';

const EMPTY: MediaSendEntry[] = [];

export function useChannelMediaSends(channelId: string): MediaSendEntry[] {
  const cacheRef = useRef<{ key: string; value: MediaSendEntry[] }>({
    key: '',
    value: EMPTY,
  });
  const getSnapshot = useCallback(() => {
    const next = listChannel(channelId);
    const prev = cacheRef.current;
    // Stable identity when the slice is unchanged, so consumers don't
    // re-render on unrelated channels' updates.
    if (
      prev.key === channelId &&
      prev.value.length === next.length &&
      prev.value.every((e, i) => e === next[i])
    ) {
      return prev.value;
    }
    cacheRef.current = { key: channelId, value: next.length === 0 ? EMPTY : next };
    return cacheRef.current.value;
  }, [channelId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface MediaSender {
  send: (inputs: MediaSendInputs) => Promise<void>;
  retry: (txnId: string) => Promise<void>;
}

export function useMediaSender(): MediaSender {
  const adapter = usePrivchatClient();

  const run = useCallback(
    async (txnId: string, inputs: MediaSendInputs) => {
      try {
        const common = {
          channel_id: inputs.channelId,
          channel_type: inputs.channelType,
          file: inputs.file,
          filename: inputs.filename,
          mime_type: inputs.mime,
          caption: inputs.caption,
          local_message_id: txnId,
        };
        if (inputs.kind === 'image') {
          await adapter.sendImage({
            ...common,
            width: inputs.width ?? 0,
            height: inputs.height ?? 0,
          });
        } else if (inputs.kind === 'video') {
          await adapter.sendVideo({
            ...common,
            width: inputs.width ?? 0,
            height: inputs.height ?? 0,
            duration: inputs.duration ?? 0,
          });
        } else {
          await adapter.sendFile(common);
        }
        // Upload + send both succeeded. The SDK inserted its own optimistic
        // row (local_message_id === txnId); ConversationPanel's hand-off
        // effect removes our entry. Remove here too in case the row is
        // already visible (idempotent).
        removeEntry(txnId);
      } catch (err) {
        // Either the upload failed (no SDK row exists → our bubble shows
        // failed + retry) or the send failed after upload (the SDK row
        // exists and owns the failed/retry UI; the hand-off effect drops
        // our entry). Marking failed is safe in both cases.
        markFailed(txnId, err instanceof Error ? err.message : String(err));
      }
    },
    [adapter],
  );

  const send = useCallback(
    async (inputs: MediaSendInputs) => {
      const txnId = createEntry(inputs);
      await run(txnId, inputs);
    },
    [run],
  );

  const retry = useCallback(
    async (txnId: string) => {
      const e = getEntry(txnId);
      if (e === undefined) return;
      markUploading(txnId);
      await run(txnId, e);
    },
    [run],
  );

  return useMemo(() => ({ send, retry }), [send, retry]);
}
