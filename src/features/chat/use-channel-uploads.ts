// Channel-scoped slice of the global uploads store. Subscribes via
// `useSyncExternalStore` so re-renders only fire when the channel's
// task list actually changes. Reference stability through a ref-cache
// — `listChannelTasks` returns a fresh array per call, which would
// otherwise trip useSyncExternalStore's identity check on every emit.

import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  listChannelTasks,
  subscribe,
  type UploadTask,
} from './uploads-store';

export function useChannelUploads(channelId: string): UploadTask[] {
  const cacheRef = useRef<{ key: string; value: UploadTask[] } | null>(null);

  const subscribeFn = useCallback(
    (onChange: () => void) =>
      subscribe(() => {
        cacheRef.current = null;
        onChange();
      }),
    [],
  );

  const getSnapshot = useCallback(() => {
    if (cacheRef.current === null || cacheRef.current.key !== channelId) {
      cacheRef.current = { key: channelId, value: listChannelTasks(channelId) };
    }
    return cacheRef.current.value;
  }, [channelId]);

  return useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot);
}
