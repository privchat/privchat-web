# Media Send Failures as Retryable Timeline Bubbles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When sending media (image/file/video), show an optimistic bubble in the timeline immediately; surface upload failures as a failed bubble with a retry button (re-uploads from the in-memory `Blob`) instead of a composer-level "上传失败".

**Architecture:** A web-layer module store (`media-send-store`) holds in-flight UPLOAD-phase entries keyed by a stable `txnId`. The conversation panel projects these into synthetic `MessageItemVM`s and merges them into the timeline. The `txnId` is threaded into the SDK send as `local_message_id`, so once upload succeeds and `sendTextMessage` inserts the real optimistic row (`local_message_id === txnId`), the panel removes the overlay entry — seamless hand-off, no duplicate bubble. Post-upload send failures are owned by the existing SDK outbox failed/retry path; only upload failures live on the overlay. In-session only: no persistence across reload (matches the approved spec).

**Tech Stack:** React 19, TypeScript, i18next, `useSyncExternalStore`. Web repo uses Playwright smoke tests + `tsc` only (no vitest); verification is typecheck + manual acceptance.

**Reference spec:** `docs/superpowers/specs/2026-05-26-media-send-failure-bubbles-design.md`

---

## File Structure

- **Create** `privchat-web/src/features/chat/media-send-store.ts` — module store: in-flight upload entries (txnId-keyed), object-URL lifecycle, subscribe, project-to-VM.
- **Create** `privchat-web/src/features/chat/use-media-send.ts` — React bindings: `useChannelMediaSends(channelId)` subscription + `useMediaSender()` orchestrator (upload+send / retry).
- **Modify** `privchat-react/src/adapter/direct-adapter.ts` — thread optional `local_message_id` into `sendImage/sendFile/sendVideo`.
- **Modify** `privchat-react/src/adapter/client-adapter.ts` — add `local_message_id?` to the three media-send method signatures.
- **Modify** `privchat-react/src/hooks/use-send-media.ts` — add `local_message_id?` to the three arg interfaces.
- **Modify** `privchat-web/src/features/chat/conversation-panel.tsx` — orchestrate sends via `useMediaSender`, merge synthetic VMs into the timeline, remove overlay when the SDK row lands, retire the upload chip band.
- **Modify** `privchat-web/src/features/chat/message-row.tsx` — render the upload/failed/retry affordance for `pending-media:` rows; suppress reply/reactions/revoke/menu on them.
- **Modify** `privchat-web/src/App.tsx` — clear `media-send-store` on account switch.
- **Modify** `privchat-web/src/i18n/locales/{en,zh-CN,vi}.ts` — `media_send` placeholder + state strings.

---

## Task 1: i18n keys for media-send bubble states

**Files:**
- Modify: `privchat-web/src/i18n/locales/en.ts` (value block after `message_preview`, and the `LocaleSchema` interface)
- Modify: `privchat-web/src/i18n/locales/zh-CN.ts`
- Modify: `privchat-web/src/i18n/locales/vi.ts`

- [ ] **Step 1: Add the `media_send` value block to zh-CN** (after the `message_preview` block):

```ts
  media_send: {
    uploading: '上传中…',
    upload_failed: '上传失败，点击重试',
    retry: '重试',
    dismiss: '移除',
    reselect: '请重新选择文件发送',
  },
```

- [ ] **Step 2: Add the same block to en.ts** (after `message_preview` value block):

```ts
  media_send: {
    uploading: 'Uploading…',
    upload_failed: 'Upload failed — tap to retry',
    retry: 'Retry',
    dismiss: 'Remove',
    reselect: 'Please re-select the file to send',
  },
```

- [ ] **Step 3: Add the type to `LocaleSchema` in en.ts** (after the `message_preview` interface block):

```ts
  media_send: {
    uploading: string;
    upload_failed: string;
    retry: string;
    dismiss: string;
    reselect: string;
  };
```

- [ ] **Step 4: Add the block to vi.ts** (after `message_preview` value block):

```ts
  media_send: {
    uploading: 'Đang tải lên…',
    upload_failed: 'Tải lên thất bại — chạm để thử lại',
    retry: 'Thử lại',
    dismiss: 'Gỡ bỏ',
    reselect: 'Vui lòng chọn lại tệp để gửi',
  },
```

- [ ] **Step 5: Verify i18n coverage gate**

Run: `cd privchat-web && npm run check:i18n`
Expected: `✓ zh-CN ... ✓ vi ...` (all match en, key count increased by 5).

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/en.ts src/i18n/locales/zh-CN.ts src/i18n/locales/vi.ts
git commit -m "i18n(web): media-send bubble state strings"
```

---

## Task 2: Thread `local_message_id` through the media-send adapter

The web layer needs the optimistic SDK row to carry the same id as the overlay's `txnId`, so the panel can detect hand-off. `buildSendImageInput`/`File`/`Video` already accept `local_message_id`; the adapter just doesn't pass it yet.

**Files:**
- Modify: `privchat-react/src/hooks/use-send-media.ts` (the three arg interfaces)
- Modify: `privchat-react/src/adapter/client-adapter.ts` (the three method signatures, ~lines 388-428)
- Modify: `privchat-react/src/adapter/direct-adapter.ts` (the three impls, ~lines 391-500)

- [ ] **Step 1: Add `local_message_id?` to the three interfaces in `use-send-media.ts`**

In `SendImageArgs`, `SendFileArgs`, `SendVideoArgs`, add after `mime_type`:

```ts
  /** Caller-supplied local id. Threaded into the send so an optimistic
   *  UI row can correlate with the eventual cache row. Auto-generated by
   *  the SDK when omitted. */
  local_message_id?: string;
```

- [ ] **Step 2: Add `local_message_id?` to the three method signatures in `client-adapter.ts`**

In each of `sendImage`, `sendFile`, `sendVideo` arg object types, add after `mime_type: string;`:

```ts
    local_message_id?: string;
```

- [ ] **Step 3: Pass it through in `direct-adapter.ts`**

In `sendImage`, change the `buildSendImageInput({...})` call to include:

```ts
      buildSendImageInput({
        channel_id: args.channel_id,
        channel_type: args.channel_type,
        from_uid: fromUid,
        caption: args.caption,
        local_message_id: args.local_message_id,
        metadata: {
          file_id: String(result.file_id),
          url: result.file_url,
          width: result.width ?? args.width,
          height: result.height ?? args.height,
        },
      }),
```

Do the same for `sendFile` (`buildSendFileInput`) and `sendVideo` (`buildSendVideoInput`): add `local_message_id: args.local_message_id,` alongside `from_uid`. Also add `local_message_id?: string;` to each method's arg type in `direct-adapter.ts` (after `mime_type: string;`) to match the interface.

- [ ] **Step 4: Typecheck react**

Run: `cd privchat-react && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Build react dist (web consumes the built output)**

Run: `cd privchat-react && npm run build`
Expected: tsc completes, no errors.

- [ ] **Step 6: Commit**

```bash
cd privchat-react
git add src/hooks/use-send-media.ts src/adapter/client-adapter.ts src/adapter/direct-adapter.ts
git commit -m "feat(adapter): thread local_message_id through media sends"
```

---

## Task 3: `media-send-store` module store

**Files:**
- Create: `privchat-web/src/features/chat/media-send-store.ts`

- [ ] **Step 1: Write the store**

```ts
// In-flight media UPLOAD-phase store. Holds an optimistic entry per
// media send while the upload (and the send that follows) is running, so
// the timeline can show a bubble immediately and surface UPLOAD failures
// as a retryable bubble. The `Blob` is retained in memory for retry.
//
// Once the SDK's own optimistic row lands (same `txnId` as
// `local_message_id`), ConversationPanel removes the entry here and the
// real cache row owns the bubble. Send-phase (post-upload) failures are
// therefore owned by the SDK outbox failed/retry path, NOT by this store
// — an entry only ever shows 'failed' for an UPLOAD failure.
//
// In-session only: nothing here is persisted. Refresh / account switch
// drops all entries (see clearAll), matching the v1 spec.

import type { MessageItemVM } from '@privchat/react';

export type MediaKind = 'image' | 'file' | 'video';
export type MediaSendStage = 'uploading' | 'failed';

/** Everything needed to (re-)run an upload+send. */
export interface MediaSendInputs {
  channelId: string;
  channelType: number;
  fromUid: string;
  kind: MediaKind;
  file: Blob;
  filename: string;
  mime: string;
  caption?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface MediaSendEntry extends MediaSendInputs {
  txnId: string;
  /** Object URL for in-bubble preview (image/video). '' for generic file. */
  previewUrl: string;
  stage: MediaSendStage;
  error?: string;
  /** Sort key; pending sends are newest so they land at the bottom. */
  timestamp: number;
}

type Listener = () => void;

const entries = new Map<string, MediaSendEntry>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

let seq = 0;
export function newTxnId(): string {
  return `media-${Date.now()}-${seq++}`;
}

function makePreviewUrl(kind: MediaKind, file: Blob): string {
  if (kind === 'image' || kind === 'video') return URL.createObjectURL(file);
  return '';
}

/** Create an entry in `uploading` and return its txnId. */
export function createEntry(inputs: MediaSendInputs): string {
  const txnId = newTxnId();
  entries.set(txnId, {
    ...inputs,
    txnId,
    previewUrl: makePreviewUrl(inputs.kind, inputs.file),
    stage: 'uploading',
    timestamp: Date.now(),
  });
  notify();
  return txnId;
}

export function markUploading(txnId: string): void {
  const e = entries.get(txnId);
  if (e === undefined) return;
  entries.set(txnId, { ...e, stage: 'uploading', error: undefined });
  notify();
}

export function markFailed(txnId: string, error: string): void {
  const e = entries.get(txnId);
  if (e === undefined) return;
  entries.set(txnId, { ...e, stage: 'failed', error });
  notify();
}

export function getEntry(txnId: string): MediaSendEntry | undefined {
  return entries.get(txnId);
}

/** Remove an entry and revoke its object URL. */
export function removeEntry(txnId: string): void {
  const e = entries.get(txnId);
  if (e === undefined) return;
  if (e.previewUrl !== '') URL.revokeObjectURL(e.previewUrl);
  entries.delete(txnId);
  notify();
}

export function listChannel(channelId: string): MediaSendEntry[] {
  const out: MediaSendEntry[] = [];
  for (const e of entries.values()) {
    if (e.channelId === channelId) out.push(e);
  }
  return out;
}

/** Drop everything (account switch / hard reset). Revokes all URLs. */
export function clearAll(): void {
  if (entries.size === 0) return;
  for (const e of entries.values()) {
    if (e.previewUrl !== '') URL.revokeObjectURL(e.previewUrl);
  }
  entries.clear();
  notify();
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Project an entry into a synthetic, self-sent, pending MessageItemVM so
 *  it renders through the normal timeline. `record_key` carries the
 *  `pending-media:` sentinel MessageRow keys off. The media bubble renders
 *  the local preview from `metadata.url`. */
export function projectEntry(e: MediaSendEntry): MessageItemVM {
  const metadata =
    e.kind === 'image'
      ? { type: 'image' as const, file_id: '', url: e.previewUrl, width: e.width ?? 0, height: e.height ?? 0 }
      : e.kind === 'video'
        ? { type: 'video' as const, file_id: '', url: e.previewUrl, width: e.width ?? 0, height: e.height ?? 0, duration: e.duration ?? 0 }
        : { type: 'file' as const, file_id: '', filename: e.filename, mime_type: e.mime };
  return {
    record_key: `pending-media:${e.txnId}`,
    local_message_id: e.txnId,
    from_uid: e.fromUid,
    content: e.caption ?? '',
    status: 'pending',
    timestamp: e.timestamp,
    is_self: true,
    read_by_peer: false,
    revoked: false,
    content_type: e.kind,
    metadata,
  };
}

/** Parse the txnId back out of a synthetic record_key, or undefined. */
export function txnIdFromRecordKey(recordKey: string): string | undefined {
  return recordKey.startsWith('pending-media:')
    ? recordKey.slice('pending-media:'.length)
    : undefined;
}
```

- [ ] **Step 2: Typecheck web**

Run: `cd privchat-web && npm run typecheck`
Expected: no errors (file compiles; `MessageItemVM` import resolves).

- [ ] **Step 3: Commit**

```bash
cd privchat-web
git add src/features/chat/media-send-store.ts
git commit -m "feat(web): media-send store for in-flight upload bubbles"
```

---

## Task 4: `use-media-send` hook (subscription + orchestrator)

**Files:**
- Create: `privchat-web/src/features/chat/use-media-send.ts`

- [ ] **Step 1: Write the hook**

```ts
// React bindings for the media-send store.
//   - `useChannelMediaSends` subscribes to the in-flight entries for a
//     channel (memoized array, stable identity when unchanged).
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
    cacheRef.current = { key: channelId, value: next };
    return next;
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
        // already present (idempotent).
        removeEntry(txnId);
      } catch (err) {
        // Either the upload failed (no SDK row exists → our bubble shows
        // failed + retry) or the send failed after upload (the SDK row
        // exists and owns the failed/retry UI; the hand-off effect will
        // drop our entry). Marking failed is safe in both cases.
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
```

- [ ] **Step 2: Typecheck web**

Run: `cd privchat-web && npm run typecheck`
Expected: no errors. (If `usePrivchatClient` is not exported from `@privchat/react`, import it from its hook path as ConversationPanel does — verify the existing import in `conversation-panel.tsx` and match it.)

- [ ] **Step 3: Commit**

```bash
git add src/features/chat/use-media-send.ts
git commit -m "feat(web): media sender hook (upload+send orchestration + retry)"
```

---

## Task 5: Render upload/failed/retry on `pending-media:` rows in `message-row.tsx`

**Files:**
- Modify: `privchat-web/src/features/chat/message-row.tsx`

Pending-media rows render the normal media bubble (preview from `metadata.url`), but their status line and failed affordance differ: while `uploading` show an uploading hint; while `failed` show retry/dismiss that drive the media-send store (NOT the SDK outbox).

- [ ] **Step 1: Add imports at the top of `message-row.tsx`**

```ts
import {
  getEntry,
  removeEntry,
  txnIdFromRecordKey,
} from './media-send-store';
import { useMediaSender } from './use-media-send';
```

- [ ] **Step 2: Compute the pending-media txnId near the top of `MessageRow` (where `mediaNode` is computed, ~line 113)**

```ts
  const mediaNode = pickMediaBubble(vm);
  const pendingTxnId = txnIdFromRecordKey(vm.record_key);
```

- [ ] **Step 3: In the media branch (the `mediaNode !== null` block, ~lines 131-161), replace the status line + outbox-failed actions with a pending-media-aware version.**

Replace this fragment:

```tsx
          <span
            className={cn(
              'text-[10px] font-mono opacity-70 flex items-center gap-1',
              vm.is_self ? 'self-end' : 'self-start text-muted-foreground',
            )}
          >
            <span>{ts}</span>
            {vm.is_self && <SelfStatusBadge vm={vm} peerReadPts={peerReadPts} />}
          </span>
          {vm.is_self && vm.outbox_status === 'failed' && (
            <FailedMessageActions
              localMessageId={vm.local_message_id}
              isSelf={vm.is_self}
            />
          )}
          <MessageReactions
            serverMessageId={vm.server_message_id}
            selfUid={selfUid}
            isSelf={vm.is_self}
          />
```

with:

```tsx
          <span
            className={cn(
              'text-[10px] font-mono opacity-70 flex items-center gap-1',
              vm.is_self ? 'self-end' : 'self-start text-muted-foreground',
            )}
          >
            <span>{ts}</span>
            {vm.is_self && pendingTxnId === undefined && (
              <SelfStatusBadge vm={vm} peerReadPts={peerReadPts} />
            )}
          </span>
          {pendingTxnId !== undefined ? (
            <MediaSendStatus txnId={pendingTxnId} />
          ) : (
            <>
              {vm.is_self && vm.outbox_status === 'failed' && (
                <FailedMessageActions
                  localMessageId={vm.local_message_id}
                  isSelf={vm.is_self}
                />
              )}
              <MessageReactions
                serverMessageId={vm.server_message_id}
                selfUid={selfUid}
                isSelf={vm.is_self}
              />
            </>
          )}
```

- [ ] **Step 4: Suppress the action menus for pending-media rows.**

The two `MessageActionsMenu` renders (`vm.is_self &&` ~line 127 and `!vm.is_self &&` ~line 203) and the avatar are fine to keep, but the menu offers reply/revoke which make no sense pre-send. Guard the self-side menu:

Change `{vm.is_self && (` before `<MessageActionsMenu ... side="left" ...>` to:

```tsx
      {vm.is_self && pendingTxnId === undefined && (
```

(Pending rows are always self-sent, so the `!vm.is_self` menu never renders for them; no change needed there.)

- [ ] **Step 5: Add the `MediaSendStatus` component at the bottom of the file** (near `FailedMessageActions`):

```tsx
function MediaSendStatus({ txnId }: { txnId: string }) {
  const { t } = useTranslation();
  const sender = useMediaSender();
  const [busy, setBusy] = useState(false);
  const entry = getEntry(txnId);
  if (entry === undefined) return null;

  if (entry.stage === 'uploading') {
    return (
      <span className="self-end text-[10px] text-muted-foreground">
        {t('media_send.uploading')}
      </span>
    );
  }

  // failed (upload phase)
  const onRetry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sender.retry(txnId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="self-end flex items-center gap-2 text-[10px] text-destructive">
      <span>{t('media_send.upload_failed')}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="underline disabled:opacity-50"
      >
        {busy ? t('status.retrying') : t('media_send.retry')}
      </button>
      <button
        type="button"
        onClick={() => removeEntry(txnId)}
        className="underline opacity-70"
      >
        {t('media_send.dismiss')}
      </button>
    </div>
  );
}
```

Note: `MediaSendStatus` reads `getEntry` directly. Because the parent re-renders when the timeline `messages` array changes (the synthetic VM is re-projected on every store `notify`), the read stays fresh. If a stale read is observed in manual testing, subscribe via `useChannelMediaSends(entry.channelId)` and look the entry up from there.

- [ ] **Step 6: Typecheck web**

Run: `cd privchat-web && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/message-row.tsx
git commit -m "feat(web): render upload/failed/retry on pending-media rows"
```

---

## Task 6: Wire the orchestrator into `conversation-panel.tsx`

**Files:**
- Modify: `privchat-web/src/features/chat/conversation-panel.tsx`

- [ ] **Step 1: Add imports** (near the other `./uploads-store` / hook imports):

```ts
import { useChannelMediaSends, useMediaSender } from './use-media-send';
import { projectEntry, removeEntry } from './media-send-store';
import { useEffect } from 'react'; // if not already imported
```

- [ ] **Step 2: Get the sender + in-flight entries** (near `const sendImage = useSendImage();`, ~line 152):

```ts
  const mediaSender = useMediaSender();
  const mediaSends = useChannelMediaSends(channelId);
```

- [ ] **Step 3: Replace `onSendImageBlob` (~lines 232-256) with the orchestrator version:**

```tsx
  const onSendImageBlob = async (file: Blob, filename: string, mime: string) => {
    const dims = await readImageDimensions(file).catch(() => ({ width: 0, height: 0 }));
    await mediaSender.send({
      channelId,
      channelType,
      fromUid: selfUid ?? '',
      kind: 'image',
      file,
      filename,
      mime,
      width: dims.width,
      height: dims.height,
    });
  };
```

- [ ] **Step 4: Replace `onSendFileBlob` (~lines 258-279):**

```tsx
  const onSendFileBlob = async (file: Blob, filename: string, mime: string) => {
    await mediaSender.send({
      channelId,
      channelType,
      fromUid: selfUid ?? '',
      kind: 'file',
      file,
      filename,
      mime,
    });
  };
```

- [ ] **Step 5: Replace `onSendVideoBlob` (~lines 281-317):**

```tsx
  const onSendVideoBlob = async (file: Blob, filename: string, mime: string) => {
    const meta = await readVideoMetadata(file).catch(() => ({
      width: 0,
      height: 0,
      duration: 0,
    }));
    await mediaSender.send({
      channelId,
      channelType,
      fromUid: selfUid ?? '',
      kind: 'video',
      file,
      filename,
      mime,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
    });
  };
```

- [ ] **Step 6: Merge synthetic VMs into the timeline.** Find where `messages` is consumed (`<MessageList messages={messages} ...>`, ~line 448). Just before the `return (`, compute a merged list:

```tsx
  // Merge in-flight media uploads as synthetic bubbles. Pending sends are
  // newest, so timestamp-sort puts them at the bottom. Once the SDK's own
  // optimistic row lands (same local_message_id as txnId), the hand-off
  // effect below removes the entry, so there is never a duplicate.
  const timelineMessages = useMemo(() => {
    if (mediaSends.length === 0) return messages;
    return [...messages, ...mediaSends.map(projectEntry)].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }, [messages, mediaSends]);
```

Then change `messages={messages}` to `messages={timelineMessages}` in the `<MessageList>` props.

(`useMemo` is already imported in this file; if not, add it.)

- [ ] **Step 7: Add the hand-off effect** (after the merge memo): when an SDK cache row with `local_message_id === txnId` appears in `messages`, remove the overlay entry (revokes its URL):

```tsx
  // Hand-off: drop the overlay entry once the real cache row exists.
  useEffect(() => {
    if (mediaSends.length === 0) return;
    const realIds = new Set(
      messages
        .filter((m) => !m.record_key.startsWith('pending-media:'))
        .map((m) => m.local_message_id)
        .filter((id): id is string => id !== undefined),
    );
    for (const e of mediaSends) {
      if (realIds.has(e.txnId)) removeEntry(e.txnId);
    }
  }, [messages, mediaSends]);
```

- [ ] **Step 8: Retire the upload chip band.** Remove the `activeUploads` chip block (~lines 465-471):

```tsx
      {activeUploads.length > 0 && (
        <div className="shrink-0 border-t bg-muted/30 px-3 py-2 space-y-1">
          {activeUploads.map((task) => (
            <UploadChip key={task.id} task={task} />
          ))}
        </div>
      )}
```

Delete that block. Then remove the now-unused `activeUploads` declaration (~line 333 `const activeUploads = useChannelUploads(channelId);`), the `useChannelUploads` import, and the `UploadChip` component definition (~line 643) plus its now-unused imports (`UploadTask`, `useChannelUploads`, and the `uploads-store` helpers `newTaskId/startTask/patchProgress/markDone/markFailed` if no longer referenced). Let `tsc` (Step 10) flag any leftover unused symbols.

- [ ] **Step 9: Object-URL cleanup on unmount is handled by `removeEntry`** (hand-off / dismiss / retry-success all call it). No extra cleanup needed in the panel — entries intentionally survive channel switch (acceptance #5).

- [ ] **Step 10: Typecheck web**

Run: `cd privchat-web && npm run typecheck`
Expected: no errors. Fix any unused-import errors left from Step 8.

- [ ] **Step 11: Commit**

```bash
git add src/features/chat/conversation-panel.tsx
git commit -m "feat(web): media sends render as timeline bubbles, retire upload chip"
```

---

## Task 7: Clear media-send store on account switch

**Files:**
- Modify: `privchat-web/src/App.tsx` (~line 35 import + the switch handler that calls `abortUploadsForSwitch`)

- [ ] **Step 1: Import `clearAll`**

```ts
import { clearAll as clearMediaSends } from '@/features/chat/media-send-store';
```

- [ ] **Step 2: Call it wherever `abortUploadsForSwitch(...)` is invoked.** Add immediately after that call:

```ts
    clearMediaSends();
```

(Search `App.tsx` for `abortUploadsForSwitch` and add the line next to each call site.)

- [ ] **Step 3: Typecheck web**

Run: `cd privchat-web && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(web): clear in-flight media sends on account switch"
```

---

## Task 8: Build, gate, and manual acceptance

**Files:** none (verification only)

- [ ] **Step 1: Ensure react dist is current** (Task 2 changed the adapter):

Run: `cd privchat-react && npm run build`
Expected: tsc completes.

- [ ] **Step 2: Web typecheck + i18n gate**

Run: `cd privchat-web && npm run typecheck && npm run check:i18n`
Expected: no type errors; all locales match.

- [ ] **Step 3: Restart the dev server with a clean Vite cache**

```bash
cd privchat-web
pkill -f vite; rm -rf node_modules/.vite
npm run dev
```

- [ ] **Step 4: Manual acceptance (against the running app).** With the file server now at `192.168.1.60`, uploads may fail until that host is up — useful for exercising the failure path.

Verify each:
1. Image upload success → bubble appears immediately, then becomes a normal sent image (✓ status), no duplicate bubble.
2. Image upload failure → a failed bubble appears **in the timeline** (not only a composer error) with "上传失败，点击重试".
3. Tap retry on a failed bubble → on success it becomes a sent image.
4. Send failure after a successful upload → the message shows the existing failed/retry (outbox) UI; no duplicate.
5. Switch channel and back during an in-flight/failed send → the bubble is still there and retryable.
6. Refresh the page → failed media bubbles are gone (v1 limit), composer is clean.
7. File and video sends behave the same way (bubble + failure path), at minimum no regression.

- [ ] **Step 5: Final commit (only if Step 4 surfaced fixes)** — otherwise the feature is already committed task-by-task.

---

## Self-Review Notes

- **Spec coverage:** Tasks map to spec do-items 1-8: chip retired (T6.8), optimistic bubble (T3/T6.6), in-memory Blob (T3), stages uploading/failed (T3/T5), upload failure → bubble (T4/T5), send failure (existing outbox via hand-off, T6.7), retry re-runs upload+send (T4 `retry`), success patch/no-duplicate (T2 id-threading + T6.7 hand-off). Object-URL lifecycle (T3 create/revoke). Retry-only-when-File-exists: `retry` no-ops if `getEntry` is undefined (T4); the entry holds the `Blob` so existence ⇔ retryable. "请重新选择文件发送" string is provided (T1) for a future state where the file is gone — not reachable in this design (entries always hold the Blob until removed), so it stays an unused safety string; acceptable.
- **Type consistency:** `txnId` is the entry id and the threaded `local_message_id`; `record_key` is `pending-media:${txnId}`; `txnIdFromRecordKey` reverses it. `MediaSendInputs` is shared by store + hook. Adapter arg field is `local_message_id` everywhere.
- **Send-failure ownership:** an entry shows `failed` only for upload failures, because on send failure the SDK optimistic row (same id) exists and the hand-off effect (T6.7) removes the overlay, leaving the SDK outbox UI to own it. `markFailed` on send failure is harmless (entry removed by the effect in the same render cycle).
