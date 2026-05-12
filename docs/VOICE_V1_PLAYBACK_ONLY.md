# Voice Message v1 — Playback Only

## Status

Implemented. Shipped as part of Round B1 (2026-05).

## Scope

Voice v1 supports **playback of existing voice messages only**. The
client can render and play voice messages it receives (or that exist
in cache), but does **not** record new ones. Recording is a separate
piece of work and intentionally out of scope here — see "Explicitly
Deferred" below.

This boundary exists so the playback path can ship and stabilize
without dragging in microphone-permission UX, MediaRecorder
capability detection, upload encoding, or backend voice-clip
storage decisions.

## Implemented

- Parse voice metadata from message payload
  (`{ metadata: { type: 'voice', file_id, url?, duration } }`)
- Render `VoiceBubble` (`▶ 00:08` idle / `⏸ 00:03 / 00:08` playing)
- Lazy-resolve file URL via `adapter.fileGetUrl(file_id)` on first
  play tap (avoids one HTTP per voice row at conversation open)
- Play / pause toggle on the same message
- Switching to a different voice message stops the previous one
- Single-active playback controller — at most one voice plays at a
  time across the whole app
- Stop playback on conversation switch / `ConversationPanel` unmount
- Loading / error / disabled DOM states (`data-state` attribute on
  the bubble for tests + assistive UI)
- Fallback chip for cross-version records that have no playable
  handle (no `url` and no `file_id`)

## Explicitly Deferred

These are **not** implemented in v1 and should not be assumed:

- Recording a new voice message (UI button, hold-to-talk, etc.)
- `MediaRecorder` integration
- Microphone permission flow
- Voice upload pipeline
- Waveform generation / display
- Variable playback speed (1x / 1.5x / 2x)
- Speech-to-text transcription
- Listened / unlistened state tracking
- Auto-play next voice message in a thread

If you find yourself adding any of the above, that is a new round of
work — not a "small follow-up" to v1. Open a fresh design note.

## Tests

- **React unit:** `tests/voice-projection.test.ts` — 5 cases
  covering well-formed payload, missing duration, missing
  `file_id`, malformed JSON, empty payload.
- **Web smoke (Playwright):** `tests/smoke/voice.spec.ts` — 3 cases
  covering idle render, click leaving idle, no-`file_id` fallback.
  CI never plays real audio (autoplay-blocking + codec flake).

## Gates

The voice surface is exercised by the standard project gate:

- `pnpm check:i18n`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e`

No voice-specific gate beyond this.

## Files of interest

- `src/features/chat/voice-playback.ts` — module-level singleton
  (`HTMLAudioElement` + state + listeners)
- `src/features/chat/use-voice-playback.ts` — `useSyncExternalStore`
  hook view onto the singleton
- `src/features/chat/media-bubbles.tsx` — `VoiceBubble` component
- `src/features/chat/conversation-panel.tsx` — `stopAll()` on
  `channelId` change / unmount
