# Media send failures as retryable timeline bubbles

Date: 2026-05-26
Scope: `privchat-web` only. Covers image / file / video.

## Problem

Sending media today does `uploadOneFile()` → `sendTextMessage()`
(`direct-adapter.ts`). The upload step runs entirely outside the
message/cache/outbox lifecycle, so an upload failure produces **no
timeline bubble** — the only signal is a red "上传失败" on the
`uploads-store` chip above the composer. Text messages, by contrast,
insert an optimistic pending bubble and show a `failed` state with retry.

The user's model: upload + send are both part of one "发送" action, so a
failure should surface as a **failed message bubble with retry**, not a
composer-level error.

## Decision

**Approach A — in-session media retry.** App-layer (web) optimistic
bubble; the original `File`/`Blob` is kept in an in-memory pending map so
retry can re-run upload+send. No SDK/outbox/IndexedDB changes.

Explicitly **not** doing (Approach B, deferred): Blob persistence in
IndexedDB, a media outbox schema, upload-task/progress recovery,
cross-reload retry, orphan-blob cleanup. That is "SDK outbox v2" and is
out of scope.

## Target behaviour

Select media → **immediately insert a pending media bubble** (local
preview + uploading state) → upload → on upload success continue to send
→ on send success bubble becomes `sent`. On upload OR send failure the
bubble becomes `failed`; the user taps retry on the bubble, which re-runs
upload+send from the in-memory `File`/`Blob`.

After refresh / account-switch / tab-close: failed media bubbles
disappear; the user must re-select the file. Accepted v1 limitation.

## Implementation boundary (privchat-web only)

Do:
1. Demote the `uploads-store` chip's failure path (failure now lives on
   the bubble, not the composer chip).
2. Create an optimistic media message immediately on file select.
3. Keep the `File`/`Blob` handle in an in-memory pending map.
4. Bubble supports `uploading` / `sending` / `failed` / `sent` stages.
5. Upload failure → bubble `failed` (`failureStage: 'upload'`).
6. `sendTextMessage` failure → bubble `failed` (`failureStage: 'send'`).
7. Retry → pull `File`/`Blob` from the pending map, re-run
   `uploadOneFile` + send.
8. On success, patch/replace the original bubble (no duplicate row).

Don't: touch SDK outbox persistence; write Blobs to IndexedDB; restore
after refresh; change the server upload protocol or the message protocol.

## Key design points

1. **Stable local anchor (`client_txn_id`).** The pending bubble needs a
   stable local id so the post-upload send and later patches land on the
   *same* bubble instead of inserting a second one.
2. **Object-URL lifecycle.** Preview via `URL.createObjectURL(file)`;
   `URL.revokeObjectURL()` on success / delete / failed-bubble cleanup to
   avoid leaking memory across repeated sends.
3. **Retry only when the in-memory `File` exists.** If the pending map has
   no `File` (e.g. survived a state reset), show "请重新选择文件发送"
   instead of a retry affordance — don't pretend retry is possible.
4. **One bubble state for both failure kinds.**
   ```ts
   type MediaSendStage = 'uploading' | 'sending' | 'failed' | 'sent';
   // failureStage: 'upload' | 'send'  → drives copy:
   //   '上传失败，点击重试' vs '发送失败，点击重试'
   ```

## Acceptance criteria

1. Image upload success → bubble goes uploading → sent.
2. Image upload failure → a `failed` bubble appears in the timeline (not
   only a composer error).
3. Tap retry on a failed bubble → success → bubble becomes sent.
4. `sendTextMessage` failure → same bubble becomes failed.
5. Switch channel and back → in-session pending is still usable.
6. Refresh → failed media is NOT restored (v1 limit).
7. File / video go through the same logic, at minimum no regression.

## Commits (kept separate)

- `fix(server): update file service base urls to 192.168.1.60` —
  config-only, `privchat-server/config.toml`.
- `feat(web): show media upload failures as retryable timeline bubbles` —
  this feature.
