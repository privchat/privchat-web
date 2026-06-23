# `privchat-web`

Official PrivChat React web client. First consumer of
[`@privchat/react`](../privchat-react/) and [`@privchat/sdk`](../privchat-sdk-typescript/).

A production-grade chat web app supporting two account systems —
**BUILTIN** (server-native password auth) and **PLATFORM** (external
account host with SMS / QR auth) — with full chat UX, multi-account
switching, media, reactions, presence, three-language i18n, and an
opt-in virtualized timeline.

## Stack

- Vite 5 + React 19 + TypeScript
- Tailwind CSS v3 + shadcn/ui (slate, CSS variables) + Radix UI primitives
- `@privchat/sdk` — WebSocket transport, FlatBuffers codec, IndexedDB cache, sync + outbox engines (file: link)
- `@privchat/react` — hooks + adapter over the SDK (file: link)
- `@tanstack/react-virtual` (virtual timeline), `i18next` (i18n), `qrcode` (QR)

## Feature modules

### Auth (`src/features/auth/`)

- **Login page** — responsive, capability-driven (shows only what the active mode supports).
- **BUILTIN**: username/password **login** + **registration** (single RPC each).
- **PLATFORM**: **SMS login** (E.164 phone + OTP, 60s resend cooldown), **QR login** (browser-driven session; paste-URL, no camera).
- **Multi-account switching** — account switcher in the topbar; sequenced switch (persist → connect → commit, rollback on failure).
- **Session-expired dialog** — surfaced when the SDK's auth-refresh coordinator can't renew the token; confirm → clear session → login.

### Chat (`src/features/chat/`)

- **Layout** — three-pane on desktop, single-pane toggle on mobile; sidebar tabs (Chats / Contacts / Groups) with unread badges.
- **Conversation list** — channels sorted by recency; type-aware last-message preview (`[图片]` / `[Image]` …, localized).
- **Message timeline** — two interchangeable renderers:
  - *Plain* (default): full DOM, ideal for normal channels.
  - *Virtual* (opt-in, `VITE_PRIVCHAT_VIRTUAL_TIMELINE=1`): measured-height virtualization for 10k+ rows, anchor-based scroll restoration, dynamic-height re-anchoring, local-echo→server-ACK key bridge.
- **Message types** — text; image (decrypt + scale + click-to-fullscreen); video (duration/dimensions); file (download chip); voice (playback-only: play/pause, progress, single-active across app); sticker; link preview; location; system; with a localized placeholder for unknown types.
- **Send** — text with draft persistence; **image / file / video** via picker, **drag-drop**, and **paste**.
- **Media send-failure bubbles** — an upload failure shows a **retryable bubble in the timeline** (not a composer-level error); retry re-runs upload+send from the in-memory blob; dismiss removes it.
- **Per-message actions** — reply with quote + jump-to-original; revoke (self, with sender-name resolution); retry / discard failed sends; **reactions** (common-emoji toggle + picker).
- **Typing indicators**, **peer read cursor** ("read by"), **presence** (online/offline + last-seen).
- **Contacts** — discovery dialog (debounced server search), pending friend-requests dialog, profile cards.
- **Groups** — create; info dialog with roster (owner/admin filtering); admin actions (remove / mute / unmute member, mute-all); add member; description + announcement editing (owner-only); leave group.
- **QR** — show my QR (namecard, copyable URL); show group QR (with destructive rotation); scan/paste-link dialog → add friend or join group.
- **Incoming notifications** — sound beep toggle + desktop notification toggle (permission-gated); suppresses self-messages and the active visible conversation.
- **Account menu** — logout, theme toggle, language switcher; dev-only log viewer.

### Onboarding (`src/features/onboarding/`)

- **Required-actions gate** — blocks the chat UI until post-login required actions (e.g. complete-profile) are cleared. State machine: idle → loading → (clear | pending | unsupported). Fails **open** on network errors (never strands the user), fails **closed** on unknown-but-required actions (unsupported page with logout).

### Profile (`src/features/profile/`)

- **Profile edit dialog** (PLATFORM mode) — nickname, bio, gender, birthday; per-field change detection (only modified fields are sent).
- **Avatar upload** — preview + MIME/size validation.

## Account modes

| | BUILTIN | PLATFORM |
| --- | --- | --- |
| Auth | password login + registration | SMS login, QR login |
| Backend | direct to privchat-server | via privchat-application (`/app` HTTP) → server |
| Token refresh | server-issued refresh token (when present) | HTTP `/auth/refresh-token` (rotating) |
| Required actions | none (returns `[]`) | post-login gate (complete-profile, …) |
| Profile editing | — | HTTP per-field PUTs |

Cross-cutting: an **SDK-owned auth-refresh coordinator** transparently
renews an expired access token (at authenticate and at auto-reconnect
replay) and only surfaces `session_expired` when refresh is terminally
impossible.

## Infrastructure

- **i18n** — English, Simplified Chinese, Vietnamese; browser detection + localStorage persistence; coverage gated by `npm run check:i18n`.
- **IndexedDB cache** — account-scoped DB naming (per AccountKey); the SDK owns channel/message/reaction/cursor persistence; cleared on logout.
- **Storage** — localStorage holds the account registry, per-account sessions, language, and notification prefs; no cookies.
- **Error reporting** — `captureException` with source context, swappable reporter sink.
- **Code-splitting** — manual vendor chunks (react / radix / i18n / icons / privchat) + lazy-loaded heavy dialogs.

## Configuration (environment)

| Variable | Purpose |
| --- | --- |
| `VITE_PRIVCHAT_ACCOUNT_MODE` | `builtin` (default) or `platform` |
| `VITE_PRIVCHAT_PLATFORM_BASE_URL` | HTTP base for PLATFORM auth/profile (e.g. `/app`) |
| `VITE_PRIVCHAT_VIRTUAL_TIMELINE` | `1` enables the virtual timeline (default off) |
| `VITE_PRIVCHAT_TEST_MODE` | `mock` mounts the Playwright test harness |
| `VITE_PRIVCHAT_DEV_PLATFORM_PROXY` | dev-only: platform proxy target (default `http://localhost:8080`) |

Local overrides go in `.env.local` (gitignored). In PLATFORM mode the dev
server proxies `/app/*` to the platform host so the browser stays
same-origin (no CORS preflight).

## Local setup

The two upstream packages must be present and built first:

```bash
# 1. SDK
cd ../privchat-sdk-typescript && npm install && npm run build
# 2. React layer
cd ../privchat-react && npm install && npm run build
# 3. This app
cd ../privchat-web && npm install && npm run dev
```

Open http://localhost:5173. In BUILTIN mode the app talks directly to a
running privchat-server; in PLATFORM mode it needs privchat-application
on the proxied `/app` host.

## Scripts

| Script | Action |
| --- | --- |
| `npm run dev` | Vite dev server (5173; proxies `/app/*`) |
| `npm run build` | `tsc -b` + Vite production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run preview` | preview the production build |
| `npm run check:i18n` | verify locale key coverage across en/zh-CN/vi |
| `npm run test:e2e` | Playwright smoke suite |
| `npm run test:e2e:ui` | Playwright UI mode |
| `npm run test:e2e:virtual` | Playwright with the virtual timeline enabled |

## Architecture

The host (this app) owns the `PrivchatClient` instance and drives its
lifecycle (`connect` / `authenticate` / `disconnect` / `dispose`). React
reads state through `DirectClientAdapter` ⇒ `<PrivchatProvider>`. See
[`../privchat-react/docs/PRIVCHAT_REACT_ARCHITECTURE.md`](../privchat-react/docs/PRIVCHAT_REACT_ARCHITECTURE.md)
for the boundary contract. Design notes for individual subsystems live in
[`docs/`](./docs/) (account modes, platform auth/profile/QR contracts,
virtual timeline, voice v1 scope).

## Not yet implemented

- **Voice**: recording (playback-only v1) — no MediaRecorder, waveform, speed control, transcription, or auto-play-next.
- **Virtual timeline**: unread markers; reply-jump for messages outside the loaded range shows an inline toast instead of fetching.
- **Profile**: username editing (avatar editing landed; username is a later round).
- **PLATFORM**: server-side logout RPC; password login / registration (SMS + QR only).

## License

Apache-2.0
