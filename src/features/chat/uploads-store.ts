// Module-level upload-task store. Keyed by an opaque task id we
// generate at upload kickoff, NOT by local_message_id (which the SDK
// only mints inside `sendTextMessage`, AFTER the upload finishes).
//
// Why a module-level store rather than per-component state:
//   - the user can switch channels mid-upload; we don't want to lose
//     the progress display when the source `ConversationPanel` unmounts
//   - multiple panels (mobile back-and-forth) stay coherent
//   - hooks subscribe via `useSyncExternalStore` so re-renders only
//     fire when the slice they read changes
//
// In-bubble progress (pre-creating a cache row before upload completes)
// is a richer follow-up; this store powers the simpler "active uploads"
// row above the composer in the meantime.

export type UploadTaskStatus = 'uploading' | 'failed' | 'done';

export interface UploadTask {
  id: string;
  channel_id: string;
  filename: string;
  /** 'image' | 'file' (other types are deferred). Drives icon choice. */
  kind: 'image' | 'file';
  /** Bytes already sent. */
  loaded: number;
  /** Bytes total. `0` when Content-Length unavailable. */
  total: number;
  /** 0-100, or `undefined` when total is unknown. */
  percent?: number;
  status: UploadTaskStatus;
  /** Last-error string when `status === 'failed'`. */
  error?: string;
}

type Listener = () => void;

const tasks = new Map<string, UploadTask>();
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

let nextId = 1;
export function newTaskId(): string {
  return `upload-${Date.now()}-${nextId++}`;
}

export function startTask(
  task: Omit<UploadTask, 'loaded' | 'total' | 'status' | 'percent'>,
): void {
  tasks.set(task.id, {
    ...task,
    loaded: 0,
    total: 0,
    status: 'uploading',
  });
  notify();
}

export function patchProgress(
  id: string,
  loaded: number,
  total: number,
  percent: number | undefined,
): void {
  const t = tasks.get(id);
  if (t === undefined) return;
  tasks.set(id, { ...t, loaded, total, percent });
  notify();
}

export function markFailed(id: string, error: string): void {
  const t = tasks.get(id);
  if (t === undefined) return;
  tasks.set(id, { ...t, status: 'failed', error });
  notify();
}

export function markDone(id: string): void {
  // 'done' tasks linger for one tick so the UI can show the 100%
  // frame, then we clear. Caller can also explicitly removeTask.
  tasks.delete(id);
  notify();
}

export function removeTask(id: string): void {
  tasks.delete(id);
  notify();
}

export function listTasks(): UploadTask[] {
  return [...tasks.values()];
}

export function listChannelTasks(channelId: string): UploadTask[] {
  const out: UploadTask[] = [];
  for (const t of tasks.values()) {
    if (t.channel_id === channelId) out.push(t);
  }
  return out;
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** R7.1 — account-switch entry point.
 *
 *  Marks every currently-uploading task as failed with `reason` as
 *  the last-error string so the active-uploads UI surfaces a
 *  per-row "switched away" message. Tasks already in `failed` or
 *  `done` states are left alone — they're already resolved.
 *
 *  This step does NOT abort the underlying XHR yet. The XHR is
 *  owned by the per-call hook (`useSendImage` / `useSendFile`) and
 *  has no shared abort signal in R7.1. R7.4 will introduce that
 *  signal alongside the full account-switch sequencer; for now
 *  the marked-failed task simply reports the wrong outcome to the
 *  UI, then the XHR settles naturally (success or error) and the
 *  task is overwritten by `markFailed` / `markDone` from the
 *  send-hook itself, which fires a final notify(). The end state
 *  is consistent either way; the surface bug is "you may briefly
 *  see a 'switched away' message right before the upload's true
 *  outcome lands". Acceptable until R7.4. */
export function abortAllForAccountSwitch(reason: string): void {
  let changed = false;
  for (const [id, t] of tasks) {
    if (t.status !== 'uploading') continue;
    tasks.set(id, { ...t, status: 'failed', error: reason });
    changed = true;
  }
  if (changed) notify();
}
