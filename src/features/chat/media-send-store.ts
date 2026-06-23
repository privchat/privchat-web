// In-flight media UPLOAD-phase store. Holds an optimistic entry per
// media send while the upload (and the send that follows) is running, so
// the timeline can show a bubble immediately and surface UPLOAD failures
// as a retryable bubble. The `Blob` is retained in memory for retry.
//
// Once the SDK's own optimistic row lands (same `txnId` threaded through
// as `local_message_id`), ConversationPanel removes the entry here and
// the real cache row owns the bubble. Send-phase (post-upload) failures
// are therefore owned by the SDK outbox failed/retry path, NOT by this
// store — an entry only ever shows 'failed' for an UPLOAD failure.
//
// In-session only: nothing here is persisted. Refresh / account switch
// drops all entries (see clearAll), matching the approved v1 spec
// (docs/superpowers/specs/2026-05-26-media-send-failure-bubbles-design.md).

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

// The txnId doubles as the SDK `local_message_id`, which is wire-encoded
// as a u64 (FlatBuffers). A non-numeric id (e.g. "media-<ts>-<n>") makes
// `BigInt(id)` throw in the send codec, so the file message silently fails
// to transmit. Mirror the SDK's snowflake-ish generator: ms timestamp in
// the high bits, a 10-bit per-tab counter in the low bits → unique decimal.
let seq = 0;
export function newTxnId(): string {
  seq = (seq + 1) & 0x3ff; // 10-bit rollover
  return ((BigInt(Date.now()) << 12n) | BigInt(seq)).toString();
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

/** Remove an entry and revoke its object URL (no leak across sends). */
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

const RECORD_KEY_PREFIX = 'pending-media:';

/** Project an entry into a synthetic, self-sent, pending MessageItemVM so
 *  it renders through the normal timeline. `record_key` carries the
 *  `pending-media:` sentinel MessageRow keys off. The media bubble renders
 *  the local preview from `metadata.url`. */
export function projectEntry(e: MediaSendEntry): MessageItemVM {
  const metadata =
    e.kind === 'image'
      ? {
          type: 'image' as const,
          file_id: '',
          url: e.previewUrl,
          width: e.width ?? 0,
          height: e.height ?? 0,
        }
      : e.kind === 'video'
        ? {
            type: 'video' as const,
            file_id: '',
            url: e.previewUrl,
            width: e.width ?? 0,
            height: e.height ?? 0,
            duration: e.duration ?? 0,
          }
        : {
            type: 'file' as const,
            file_id: '',
            filename: e.filename,
            mime_type: e.mime,
          };
  return {
    record_key: `${RECORD_KEY_PREFIX}${e.txnId}`,
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
  return recordKey.startsWith(RECORD_KEY_PREFIX)
    ? recordKey.slice(RECORD_KEY_PREFIX.length)
    : undefined;
}
