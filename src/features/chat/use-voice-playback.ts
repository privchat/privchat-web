// Hook view onto the voice-playback singleton. Returns the current
// playback state when `messageId` is the active message, or `null`
// when something else (or nothing) is playing. Bubbles use this to
// pick between idle (▶) and active (⏸ + progress) affordances.

import { useSyncExternalStore } from 'react';
import {
  getState,
  subscribe,
  type VoicePlaybackState,
} from './voice-playback';

export function useVoicePlayback(messageId: string): VoicePlaybackState | null {
  return useSyncExternalStore(
    subscribe,
    () => getState(messageId),
    () => null,
  );
}
