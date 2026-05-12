// Bridges inbound L1 message events into two browser-native side
// effects: a short notification ping + an OS desktop notification when
// the tab is hidden. Both are gated on user opt-in (per-feature toggle
// stored in localStorage) and sender filtering (skip own messages,
// skip the currently-active conversation when the tab is visible).
//
// Sound implementation uses a tiny inline WebAudio beep — no asset
// shipping, no autoplay-policy fuss because the user toggle is already
// a gesture. Volume is intentionally low (0.04) so the prompt never
// startles anyone; chat apps live and die by this.
//
// Desktop notification permission is requested explicitly via
// `requestDesktop()`, NOT on mount (showing a permission popover on
// every page load is the worst-of-Web pattern). Until the user opts
// in, `desktopState === 'default'` and no notifications fire.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  usePrivchatClient,
  useUserProfile,
} from '@privchat/react';

const SOUND_PREF_KEY = 'privchat:notify:sound';
const DESKTOP_PREF_KEY = 'privchat:notify:desktop';

export type DesktopPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface IncomingNotifier {
  soundEnabled: boolean;
  setSoundEnabled: (b: boolean) => void;

  desktopEnabled: boolean;
  desktopState: DesktopPermissionState;
  requestDesktop: () => Promise<DesktopPermissionState>;
  setDesktopEnabled: (b: boolean) => void;
}

/**
 * @param activeChannelId  channel currently visible in the panel; we
 *   suppress notifications for it when the tab is in the foreground
 *   (user is already looking at the message).
 */
export function useIncomingNotifier(
  activeChannelId: string | null,
): IncomingNotifier {
  const adapter = usePrivchatClient();
  const selfUid = adapter.sessionSnapshot().user_id;

  const { t } = useTranslation();

  // ---- prefs ----
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() =>
    readPref(SOUND_PREF_KEY, true),
  );
  const setSoundEnabled = useCallback((b: boolean) => {
    writePref(SOUND_PREF_KEY, b);
    setSoundEnabledState(b);
  }, []);

  const [desktopEnabled, setDesktopEnabledState] = useState<boolean>(() =>
    readPref(DESKTOP_PREF_KEY, false),
  );
  const setDesktopEnabled = useCallback((b: boolean) => {
    writePref(DESKTOP_PREF_KEY, b);
    setDesktopEnabledState(b);
  }, []);

  const desktopState = readDesktopState();

  const requestDesktop = useCallback(async (): Promise<DesktopPermissionState> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    const r = await Notification.requestPermission();
    if (r === 'granted') {
      writePref(DESKTOP_PREF_KEY, true);
      setDesktopEnabledState(true);
    }
    return r as DesktopPermissionState;
  }, []);

  // ---- live refs to dodge effect re-subscribe on prefs change ----
  const soundRef = useRef(soundEnabled);
  const desktopRef = useRef(desktopEnabled);
  const activeRef = useRef(activeChannelId);
  useEffect(() => {
    soundRef.current = soundEnabled;
  }, [soundEnabled]);
  useEffect(() => {
    desktopRef.current = desktopEnabled;
  }, [desktopEnabled]);
  useEffect(() => {
    activeRef.current = activeChannelId;
  }, [activeChannelId]);

  // ---- subscribe to message_received once ----
  useEffect(() => {
    const off = adapter.observeEvents((env) => {
      if (env.event.type !== 'message_received') return;
      const msg = env.event.message;
      // Skip own echoes — the SDK forwards them too for multi-device.
      if (selfUid !== undefined && msg.from_uid === selfUid) return;
      // System notifications (read cursor, etc) come through but we
      // don't want to ping for those. Filter by content presence.
      if (msg.payload.length === 0) return;
      // R6.c: skip notification when the channel is user-muted.
      // Cached lookup — no RPC, just the in-memory channel list.
      const channel = adapter
        .cachedChannels()
        .find((c) => c.channel_id === msg.channel_id);
      if (channel?.muted === true) return;

      const isVisible =
        typeof document !== 'undefined' && document.visibilityState === 'visible';
      const isActive = activeRef.current === msg.channel_id;
      // Visible AND looking at the same conversation → user already
      // sees the message; no ping/notification.
      if (isVisible && isActive) return;

      if (soundRef.current) playPing();
      if (desktopRef.current && readDesktopState() === 'granted' && !isVisible) {
        notifyDesktop(t('notify.new_message'));
      }
    });
    return off;
  }, [adapter, selfUid, t]);

  return {
    soundEnabled,
    setSoundEnabled,
    desktopEnabled,
    desktopState,
    requestDesktop,
    setDesktopEnabled,
  };
}

// Suppress `useUserProfile` unused-import warnings if any future hook
// dependency wants the sender's name in the notification title — kept
// here as a hook-shaped seam without needing a dep churn.
void useUserProfile;

// ----- helpers -----

function readPref(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === '1';
}

function writePref(key: string, value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value ? '1' : '0');
}

function readDesktopState(): DesktopPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as DesktopPermissionState;
}

let audioCtx: AudioContext | null = null;
function playPing(): void {
  try {
    if (audioCtx === null) {
      const Ctor =
        (window as Window & {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }).AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor === undefined) return;
      audioCtx = new Ctor();
    }
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // A5, short and clear
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.02);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    /* best-effort; silent failure */
  }
}

function notifyDesktop(title: string): void {
  try {
    new Notification(title);
  } catch {
    /* permission revoked between check and call */
  }
}
