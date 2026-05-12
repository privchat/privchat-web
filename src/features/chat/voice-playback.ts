// Single-active voice-playback controller.
//
// One module-level `HTMLAudioElement` is shared across every voice
// bubble in the app. Starting playback for a different message stops
// whichever message was previously active, so the user can never have
// two voice messages talking over each other. Switching channels (or
// unmounting the conversation panel) calls `stopAll()`.
//
// Each bubble subscribes via `useVoicePlayback(messageId)`; the hook
// returns `null` whenever some OTHER message is the active one (or
// nothing is active), which the bubble interprets as "show the idle
// ▶ affordance".
//
// URLs are resolved lazily — the bubble passes a `resolveUrl` thunk
// (typically calling `adapter.fileGetUrl(file_id)`) which we only
// invoke on the first play tap. This avoids one HTTP round-trip per
// rendered voice message at conversation-open time.
//
// Test posture: voice-playback.test.ts substitutes a fake Audio
// constructor on `globalThis` so we can drive timeupdate/ended/error
// without a real codec. CI never plays audio.

export type VoicePlaybackStatus = 'loading' | 'playing' | 'paused' | 'error';

export interface VoicePlaybackState {
  messageId: string;
  status: VoicePlaybackStatus;
  currentTimeMs: number;
  durationMs: number;
  error?: string;
}

type Listener = () => void;

let audio: HTMLAudioElement | null = null;
let active: VoicePlaybackState | null = null;
let activeToken = 0;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'playback failed';
}

function ensureAudio(): HTMLAudioElement {
  if (audio !== null) return audio;
  const el = new Audio();
  el.preload = 'metadata';
  el.addEventListener('loadedmetadata', () => {
    if (active === null) return;
    const ms = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
    active = { ...active, durationMs: ms };
    notify();
  });
  el.addEventListener('timeupdate', () => {
    if (active === null) return;
    active = { ...active, currentTimeMs: Math.round(el.currentTime * 1000) };
    notify();
  });
  el.addEventListener('play', () => {
    if (active === null) return;
    if (active.status === 'playing') return;
    active = { ...active, status: 'playing' };
    notify();
  });
  el.addEventListener('pause', () => {
    if (active === null) return;
    if (el.ended) return;
    if (active.status === 'paused') return;
    active = { ...active, status: 'paused' };
    notify();
  });
  el.addEventListener('ended', () => {
    active = null;
    notify();
  });
  el.addEventListener('error', () => {
    if (active === null) return;
    active = { ...active, status: 'error', error: 'playback failed' };
    notify();
  });
  audio = el;
  return el;
}

/** Toggle playback for `messageId`. Same-message → play/pause flip;
 *  different message → stop the current and start the new one;
 *  error state → retry by reloading. `resolveUrl` is awaited
 *  exactly once per (re)load, so the caller can return a freshly
 *  signed URL each time without us caching a stale one. */
export async function toggle(
  messageId: string,
  resolveUrl: () => Promise<string>,
): Promise<void> {
  const el = ensureAudio();
  if (active !== null && active.messageId === messageId) {
    if (active.status === 'playing') {
      el.pause();
      return;
    }
    if (active.status === 'paused') {
      try {
        await el.play();
      } catch (e) {
        if (active?.messageId === messageId) {
          active = { ...active, status: 'error', error: errMsg(e) };
          notify();
        }
      }
      return;
    }
    if (active.status === 'loading') return;
    // status === 'error' → fall through to reload path
  }

  // Stop whatever was playing and load fresh.
  el.pause();
  el.removeAttribute('src');
  try {
    el.load();
  } catch {
    // jsdom can throw on load() with empty src; harmless.
  }
  const token = ++activeToken;
  active = {
    messageId,
    status: 'loading',
    currentTimeMs: 0,
    durationMs: 0,
  };
  notify();

  let url: string;
  try {
    url = await resolveUrl();
  } catch (e) {
    if (token !== activeToken) return;
    active = {
      messageId,
      status: 'error',
      currentTimeMs: 0,
      durationMs: 0,
      error: errMsg(e),
    };
    notify();
    return;
  }
  if (token !== activeToken) return;

  el.src = url;
  try {
    await el.play();
  } catch (e) {
    if (token !== activeToken) return;
    active = {
      messageId,
      status: 'error',
      currentTimeMs: 0,
      durationMs: 0,
      error: errMsg(e),
    };
    notify();
  }
}

/** Stop the active message (if any) and clear state. Called on
 *  conversation switch / panel unmount so a voice doesn't keep
 *  playing in the background of an unrelated screen. */
export function stopAll(): void {
  activeToken++;
  if (audio !== null) {
    audio.pause();
    audio.removeAttribute('src');
    try {
      audio.load();
    } catch {
      // see comment in toggle()
    }
  }
  if (active !== null) {
    active = null;
    notify();
  }
}

/** R7.1 — explicit account-switch entry point.
 *
 *  Today this is just `stopAll()` under a new name: voice playback
 *  has no per-account state of its own, only "the one currently
 *  playing message". Stopping that on switch is sufficient.
 *
 *  Surfaced as a separate function so the future R7.4 switch
 *  sequencer (`stop active timers / streams` step) has a stable
 *  call site even if voice-playback later grows account-aware
 *  state (e.g. per-account playback queues). Callers SHOULD use
 *  this rather than `stopAll()` for the account-switch path so
 *  the diff at R7.4 doesn't have to chase down conversation-
 *  switch vs account-switch call sites. */
export function clearForAccountSwitch(): void {
  stopAll();
}

/** Snapshot getter for `useSyncExternalStore`. Returns the live
 *  state when `messageId` is the active message, else `null`. The
 *  `null` reference is stable across calls, so non-active bubbles
 *  don't re-render on every state change. */
export function getState(messageId: string): VoicePlaybackState | null {
  if (active === null) return null;
  if (active.messageId !== messageId) return null;
  return active;
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Test-only reset; not exported from the package barrel. Lets unit
// tests start each case from a clean singleton without leaking
// state between specs.
export function __resetForTests(): void {
  if (audio !== null) {
    audio.pause();
  }
  audio = null;
  active = null;
  activeToken = 0;
  listeners.clear();
}
