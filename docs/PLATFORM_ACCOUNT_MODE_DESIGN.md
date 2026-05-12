# Platform Account Mode Design Note (R8)

Design note frozen **before** implementation. The point is to commit
the boundary between BUILTIN and PLATFORM modes — what each owns,
where seams go, and how this round interacts with R7 multi-account
— so the implementation PRs don't pull "edit nickname", "QR login",
"SMS login", "avatar upload", and "platform-side mirror sync" all
into the login page at the same time.

## Status

R8.0 baseline frozen; subsequent rounds tracked below. R7
(multi-account) closed at R7.5; R8 plugs into R7's
accountKey-based isolation as originally planned.

| Round | State | Notes |
|-------|-------|-------|
| R8.0 | shipped — this doc | original design baseline |
| R8.1 | shipped | auth seam (`AccountAuthProvider`, `AccountProfileProvider`, `AccountCapabilities`) + factory; BUILTIN provider wired |
| R8.2 | shipped | LoginPage routed through provider; BUILTIN regression smokes |
| R8.2b | shipped | HTTP contract frozen in companion doc — see [PLATFORM_AUTH_HTTP_CONTRACT.md](./PLATFORM_AUTH_HTTP_CONTRACT.md) |
| R8.2c | shipped | reconciled R8.0 with R8.2b's findings (token unification, no PLATFORM register, SMS as primary, decisions on UI scope and persistence) |
| R8.3a | shipped | `PlatformAuthProvider` HTTP envelope client + `sendSmsCode` + `loginWithSms` + `refreshToken`; 7 smoke cases |
| R8.3b | shipped | LoginPage capability-gated SMS UI + 60s cooldown + R7/R8 PLATFORM persistence invariant; 5 smoke cases |
| R8.3c | absorbed by R8.3b | originally split-off SMS UI round; merged into R8.3b since the form is the only consumer of the seam |
| R8.4a | shipped | docs(web): two contract documents — [PLATFORM_PROFILE_HTTP_CONTRACT.md](./PLATFORM_PROFILE_HTTP_CONTRACT.md) (member profile HTTP API) + [PLATFORM_REQUIRED_ACTIONS_CONTRACT.md](./PLATFORM_REQUIRED_ACTIONS_CONTRACT.md) (Post-login Required Actions framework) |
| R8.4a-server | shipped | feat(application): `RequiredAction` DTO with `action / required / title / titleKey / fields`; `RequiredActionsLogic` v1 (nickname-pattern fallback); `RequiredActionsController` mounted at `/app/account/required-actions`; `MemberLoginResponse.requiredActions` injected by `MemberAuthLogic`; curl-verified 6/6 cases pass |
| R8.4b | shipped | feat(web): two providers — `PlatformProfileProvider` (`getProfile` + `updateNickname`) + `RequiredActionsProvider` (PLATFORM HTTP + BUILTIN noop); 9-case smoke |
| R8.4c | shipped | feat(web): `RequiredActionsGate` + `<CompleteProfileAction>` + `<UnsupportedRequiredActionPage>` + localStorage pending + auto-login re-check; 13-case smoke |
| R8.4d-1 | shipped | feat(web): `<ProfileEditDialog>` self-edit affordance in `ProfileCard`; `PlatformProfileProvider.updateBio / updateGender / updateBirthday` HTTP impls; per-field diff PUT; 9-case smoke |
| R8.4d-2 | shipped | feat(web): avatar `uploadAvatar` (multipart `/infra/file/upload`, single `/app`) + `updateAvatar` (`/app/app/member/user/update-avatar`); client mime/size guards (jpeg/png/webp ≤ 5MB); local blob preview; 9-case smoke |
| R8.4f-sdk | shipped | feat(privchat-app): SDK contract — `RequiredAction` DTO + `PlatformMemberLoginResponse.requiredActions` + `AccountCredentials.requiredActions` + `RequiredActionsApi` (Builtin noop + Platform HTTP `/account/required-actions`); 8-case unit test |
| **R8.4** | **complete** | Required Actions + Web Profile Editor MVP. Server curl chain 8/8; browser manual UI verification 12/12 (mobile `+8615900099101` → gate → set nickname → workspace → edit profile → avatar upload → refresh self-heal). Derived-only model; no actions table. **v2 `profile_completed_at`** + **v3 assignment table** stay future (see PLATFORM_REQUIRED_ACTIONS_CONTRACT §14c Future Note). **R8.4d-3 username** deferred — not a Required Action surface, will be its own round when needed |

> **R8.2c reading guide.** Sections that were rewritten in place are
> tagged **(amended R8.2c)**. A summary of every change lives in
> [§R8.2c amendments](#r82c-amendments) directly below. The rest of
> the document still holds.

## R8.2c amendments

Single-shot changelog of what R8.2c changed and why. Detailed
contracts live in `PLATFORM_AUTH_HTTP_CONTRACT.md`.

| # | Change | Why |
|---|--------|-----|
| 1 | **Token model: unified, not double.** Drop `imToken` / `imRefreshToken` / `imDeviceId` everywhere. `LoginResult.accessToken` is the single token used for both application HTTP and IM WebSocket. | TOKEN_UNIFICATION_SPEC v1.3 supersedes ACCOUNT_IDENTITY_SPEC §5; server DTO already enforces this (`MemberLoginResponse.kt` head comment forbids the legacy fields). |
| 2 | **PLATFORM has no independent register.** Remove any `registerWithPassword` plan from PLATFORM. SMS-login auto-registers on first sight of a mobile. | Native `PlatformAccountLoginImpl.kt` interface explicitly states "首次也即注册（无独立 register 入口）". |
| 3 | **PLATFORM password login is NOT exposed by Web v1.** The `/auth/login` HTTP endpoint exists, but R8.3 won't ship UI/provider for it. Decision is product-level, can be reopened in R8.4+ if needed. | Native PLATFORM client never calls `/auth/login`; mobile/desktop UX is SMS / QR. Web mirrors that to avoid inventing a divergent auth surface. |
| 4 | **SMS is two-step.** R8.1's single `loginWithSms` interface is insufficient — UI needs to call `sendSmsCode` first, then `loginWithSms`. R8.2c adds `sendSmsCode?(input)` to `AccountAuthProvider`. | Server speced this way (`/auth/send-sms-code` separate from `/auth/sms-login`); UX needs the first call to start a cooldown timer. |
| 5 | **`platformBaseUrl` MUST be persisted** in `PersistedSession` and `AccountEntry` on PLATFORM login. | Auto-login + refresh need to reconstruct the provider without re-reading env. R7 multi-account future-proofing: different accounts could come from different platforms. |
| 6 | **`VITE_PRIVCHAT_PLATFORM_BASE_URL` shape contract.** Must be `https://host[/path-prefix]/app` with no trailing slash. Web client only appends controller-level paths (e.g. `/auth/sms-login`). | Mirrors native `PlatformAccountLoginImpl` baseUrl docstring exactly; getting this wrong breaks every endpoint. |
| 7 | **Response envelope is `{ code, message?, data? }`,** `code === 0` means success. Not HTTP status. Web client must decode this consistently. | application Kotlin convention; `PlatformEnvelope<T>.requireOk()` is the reference. |
| 8 | **SMS cooldown UX**: 60s local timer, no server retry-after. Resolves R8.0 Open Question 2. | Server limits 5/60s/IP — local 60s is the safest one-size-fits-all without a server hint. |
| 9 | **`AccountAuthProvider` interface uses `?` for capability methods.** UI gates by `typeof provider.method === 'function'`, not by `mode === 'platform'`. | Capability gate (R8.0 §"Capability gate") was already the rule; R8.2c just makes the interface declaration honest about which methods are mode-specific. |
| 10 | **Drop `restoreSession` from the seam.** R8.1/R8.2 didn't ship it; R7's `App.tsx` does the equivalent inline (read session → call SDK authenticate). Removing avoids a phantom interface method. | Reduce contract surface to what's actually implemented. |

## Goal

Let `privchat-web` work against either of the two account systems
PrivChat supports:

- **BUILTIN** — `privchat-server`'s built-in `account/auth/login`
  (username + password). Today's behaviour. Most internal /
  developer environments.
- **PLATFORM** — `privchat-application` (a.k.a.
  `privchat-platform`)'s HTTP API. Adds full user profile editing,
  avatar upload, SMS login, and QR-from-app login. Most production
  consumer deployments.

The choice is **compile-time** (Vite env), aligned with how
`privchat-app`'s Kotlin `PrivChatAppConfig.accountMode` works
(`spec/01-global/SERVER_PLATFORM_BOUNDARY_SPEC.md` §4 plus
`AccountLoginFactory.kt`). One build = one mode; toggling requires a
rebuild and a fresh load. Per-account-mode toggling at runtime is
explicitly not in scope.

## Non-goals

Not part of R8:

- Mode switching at runtime (no `setAccountMode()` API)
- Multi-org / multi-tenant under a single account (different
  problem; PrivChat doesn't model "workspace" today)
- BUILTIN-mode profile editing (`account/user/update` is a stub on
  server; no UI surface in this round either)
- BUILTIN-mode QR login (QR is a `privchat-platform` capability)
- Migrating an existing BUILTIN install to PLATFORM (different
  account systems = different `user_id` namespaces; this is a
  fresh logout/login from the user's POV)
- App-side QR scanner work (lives in `privchat-app`, not here)
- Server-side mirror-field sync mechanics (server keeps
  `display_name` / `avatar_url` / `username` as IM-display
  mirrors; the actual sync is a `privchat-platform` ↔
  `privchat-server` concern, not Web's)

## The two modes — what each owns

### BUILTIN

| Surface | Owner |
|---------|-------|
| Login (username + password) | `privchat-server` `account/auth/login` |
| Token refresh | `privchat-server` |
| Profile editing | NOT EXPOSED in Web |
| Avatar upload | NOT EXPOSED |
| SMS login | NOT EXPOSED |
| QR login | NOT EXPOSED |
| IM messaging / channels / groups / etc. | `privchat-server` |

If `privchat-server`'s `account/user/update` ever ships, BUILTIN
gains profile editing — but per the
`SERVER_PLATFORM_BOUNDARY_SPEC.md` direction, it probably won't,
because PROFILE belongs to the platform layer, not IM core.

### PLATFORM

| Surface | Owner |
|---------|-------|
| Login — SMS (primary) | `privchat-platform` HTTP `auth/sms-login` + `auth/send-sms-code` |
| Login — password | endpoint `auth/login` exists but **NOT exposed by Web v1** (R8.2c §3) |
| Token refresh | `privchat-platform` HTTP `auth/refresh-token` |
| Profile editing (nickname / username / bio / gender / birthday) | `privchat-platform` HTTP `app/member/user/*` |
| Avatar upload | `privchat-platform` HTTP `infra/file/upload` |
| QR login (Web is the **target**) | unauth ws to `privchat-server` for scene + push, plus `privchat-platform` HTTP for app-side scan/confirm/reject — see `spec/05-feature/QR_LOGIN_SPEC.md` §3 |
| IM messaging / channels / groups / etc. | `privchat-server` |

The IM transport and cache (today's whole `@privchat/sdk` surface)
do not change between modes. Modes only affect **how the user
acquires the IM access token + how their profile is read/written**.

### Server-side mirror fields

`privchat-server` retains a small set of IM-display mirror fields
(`display_name`, `avatar_url`, `username`) populated by
`privchat-platform`. The Web client is the **reader** of these
fields for IM rendering (avatar in chat header, display name in
message rows) and never writes them directly to server in either
mode. Profile writes in PLATFORM go to `privchat-platform`, which
then mirrors back to server.

This means even in PLATFORM mode, `getCachedUser(uid).avatar_url`
remains the right way to render an avatar — we don't dual-fetch
from platform on every render.

## Config surface (amended R8.2c)

```text
VITE_PRIVCHAT_ACCOUNT_MODE = 'builtin' | 'platform'   // default: 'builtin'
VITE_PRIVCHAT_SERVER_URL    = 'ws://...'              // IM gateway WebSocket URL
VITE_PRIVCHAT_PLATFORM_BASE_URL = 'https://host[/prefix]/app'  // required iff mode=platform
```

Validation (asserted at module load):

- `mode === 'platform'` ⇒ `VITE_PRIVCHAT_PLATFORM_BASE_URL` must be
  non-empty. Mirrors privchat-app's
  `require(accountMode != PLATFORM || !platformBaseUrl.isNullOrBlank())`.
- `mode === 'builtin'` ⇒ `VITE_PRIVCHAT_PLATFORM_BASE_URL` is
  ignored.

**`VITE_PRIVCHAT_PLATFORM_BASE_URL` shape (R8.2c contract):**

- MUST include the application's `/app` route-group prefix (e.g.
  `https://app.example.com/app`)
- MUST NOT include a trailing slash
- Web client only appends controller-level paths (`/auth/sms-login`,
  `/auth/refresh-token`, …); the route-group prefix is fully
  carried by this env var. Mirrors `PlatformAccountLoginImpl.kt`'s
  `baseUrl` docstring byte-for-byte.

R8.3 should validate the trailing-slash rule and warn (not throw) on
violation, then strip — leniency on dev configs without breaking
prod.

`serverUrl` (IM WebSocket, `ws://` or `wss://`) and `platformBaseUrl`
(application HTTP, `https://`) are **two independent URLs**. PLATFORM
mode uses both: HTTP for auth, WebSocket for messaging.

**Response envelope (R8.2c contract).** All `auth/*` HTTP responses
are `{ code: number, message?: string, data?: T }`; success means
`code === 0`, not HTTP 200. The Web client must decode this
envelope (mirroring native `PlatformEnvelope<T>.requireOk()`).

The dev-mode "type a gateway URL" override on `LoginPage` keeps
working; it adjusts `serverUrl` in-memory only and is not persisted.
PLATFORM `baseUrl` does **not** get a runtime override in v1
(introducing it adds attack surface — the platform URL is much
more sensitive than the IM gateway URL).

## Backend boundary — frozen up front

> R8 v1 assumes **one platform authority per server_url**. If
> multiple platform authorities can bind to the same server_url,
> `AccountKey` must include `platformBaseUrl` or a
> `platformTenantId`. Today, AccountKey is
> `sha256("${server_url}|${user_id}").substring(0,16)` from R7.2a;
> that is correct for v1. The day a deployment has two platform
> backends fronting the same server, this assumption needs to be
> revisited and the AccountKey derivation extended; the seam in
> `account-key.ts` is one function.

This is the single most important assumption to write down before
code lands. R8.1 must add a comment in `account-key.ts` pointing at
this section, and a TODO marker for the multi-platform-per-server
case.

## Auth seam (amended R8.2c)

```ts
type AccountMode = 'builtin' | 'platform';

/**
 * BUILTIN: `username` is the server-side username.
 * PLATFORM (if ever exposed): `username` field would carry the
 * E.164 mobile. R8.3 does NOT implement this branch.
 */
interface PasswordLoginInput {
  serverUrl: string;
  username: string;
  password: string;
  device: DeviceInfo;
}

/**
 * R8.2c: SMS is two-step. UI calls sendSmsCode first, then
 * loginWithSms. Both carry platformBaseUrl + serverUrl explicitly
 * so the provider doesn't have to re-read env mid-call.
 */
interface SendSmsCodeInput {
  platformBaseUrl: string;
  mobile: string;             // E.164
  scene: 'login';             // R8.3 only uses scene=1; reserved for future
}

interface SendSmsCodeResult {
  /** UI uses this to start its local cooldown timer. R8.3
   *  defaults to 60 (server limits 5/60s/IP and doesn't return a
   *  Retry-After today; 60 is the safest one-size-fits-all). */
  cooldownSeconds: number;
}

interface SmsLoginInput {
  platformBaseUrl: string;
  serverUrl: string;
  mobile: string;
  smsCode: string;
  device: DeviceInfo;
}

interface LoginResult {
  serverUrl: string;
  userId: string;
  /**
   * Unified token (R8.2c). Server-signed RS256 JWT with
   * audience = ['privchat-application', 'privchat-server'].
   * Used as Bearer for application HTTP AND directly fed to the
   * IM SDK's authenticate() — no separate IM token exchange.
   */
  accessToken: string;
  deviceId: string;
  accountMode: AccountMode;
  /** PLATFORM: required (server returns it). BUILTIN: omitted. */
  refreshToken?: string;
  /** PLATFORM: required (must be persisted on session for refresh
   *  & multi-account). BUILTIN: omitted. */
  platformBaseUrl?: string;
}

/**
 * Capability methods are optional on the interface. The provider
 * exposes only what its mode actually supports; UI gates by
 * `typeof provider.method === 'function'` (NOT by `mode ===
 * 'platform'`). R8.2 already enforces this for `loginWithSms`.
 *
 * The mode-by-method matrix:
 *
 *   method                BUILTIN    PLATFORM (R8.3)
 *   ──────────────────────────────────────────────────
 *   loginWithPassword     ✓          ✗ (endpoint exists, not exposed)
 *   registerWithPassword  ✓          ✗ (no register concept)
 *   sendSmsCode           ✗          ✓
 *   loginWithSms          ✗          ✓
 *   refreshToken          ✓ (no-op)  ✓
 *   logout                ✗          ✗ (R8 v1 doesn't ship server logout)
 */
interface AccountAuthProvider {
  readonly mode: AccountMode;
  loginWithPassword?(input: PasswordLoginInput): Promise<LoginResult>;
  registerWithPassword?(input: PasswordLoginInput): Promise<LoginResult>;
  sendSmsCode?(input: SendSmsCodeInput): Promise<SendSmsCodeResult>;
  loginWithSms?(input: SmsLoginInput): Promise<LoginResult>;
  refreshToken?(session: PersistedSession): Promise<PersistedSession>;
  logout?(session: PersistedSession): Promise<void>;
}
```

> **Removed in R8.2c:** `restoreSession()` — R8.1/R8.2 never
> implemented it; R7's `App.tsx` performs the equivalent inline
> (read session → `client.authenticate(accessToken)`). Keeping it on
> the interface invited drift between the contract and reality.

Implementations:

- `BuiltinAuthProvider` (R8.2 shipped) — implements
  `loginWithPassword` + `registerWithPassword`. `refreshToken` is a
  no-op passthrough (`async session => session`); server keeps the
  access token alive lazily today. `loginWithSms` / `sendSmsCode` /
  `logout` deliberately absent so `typeof === 'function'` returns
  false.
- `PlatformAuthProvider` (R8.3) — implements `sendSmsCode` +
  `loginWithSms` + `refreshToken`. **Does NOT implement
  `loginWithPassword`** in v1 (R8.2c §3 decision). Calls
  `privchat-platform` HTTP at `${platformBaseUrl}/auth/{...}`,
  decodes `{code,message,data}` envelope, throws on `code !== 0`.
  Mirrors `PlatformAccountLoginImpl.kt`'s contract — see
  [PLATFORM_AUTH_HTTP_CONTRACT.md](./PLATFORM_AUTH_HTTP_CONTRACT.md)
  for byte-level shapes.

The factory matches `privchat-app`'s
`AccountLoginFactory.create(...)`. Single switch in one place; the
rest of the app reads through `AccountAuthProvider` only.

`LoginResult.accountMode` is included in the result so the
downstream code that writes the registry / session blob doesn't
have to peek at the env var again. Single source of truth at the
provider layer. `LoginResult.platformBaseUrl` (PLATFORM only) MUST
be persisted alongside it — see the AccountEntry / PersistedSession
section below.

## Profile seam

```ts
interface UserProfile {
  user_id: string;
  username?: string;
  nickname?: string;
  avatar_url?: string;
  bio?: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthday?: string;            // YYYY-MM-DD
  // Read-only fields the server populates:
  is_friend?: boolean;
}

interface UpdateProfileInput {
  nickname?: string;
  bio?: string;
  gender?: UserProfile['gender'];
  birthday?: string;
}

interface AccountProfileProvider {
  /** Refresh from authoritative source. PLATFORM hits
   *  `app/member/user/get`; BUILTIN reads from server cache only
   *  (no remote refresh — server doesn't own this surface). */
  getProfile(): Promise<UserProfile>;
  /** Returns the new profile snapshot. Backed by per-field PUT
   *  endpoints under PLATFORM (`update-nickname` / `update-bio` /
   *  `update-gender` / `update-birthday`); BUILTIN throws. */
  updateProfile(input: UpdateProfileInput): Promise<UserProfile>;
  /** PLATFORM: POST `infra/file/upload` for the file, then
   *  PUT `app/member/user/update-avatar` with the returned URL.
   *  BUILTIN throws. */
  uploadAvatar(file: File): Promise<{ avatarUrl: string }>;
  /** PLATFORM: PUT `app/member/user/update-username`. BUILTIN
   *  throws. Username changes have stricter server-side validation
   *  (uniqueness, character rules) so callers must surface the
   *  thrown error to the user. */
  setUsername(username: string): Promise<void>;
}
```

Two implementations: `BuiltinProfileProvider` (every write throws
`ProfileEditNotSupported`; `getProfile` reads cache only) and
`PlatformProfileProvider`. The UI never instantiates either — it
goes through the capability layer.

## Capability gate

UI code MUST NOT branch on `mode === 'platform'` directly. Branch
on capabilities.

```ts
interface AccountCapabilities {
  profileEdit: boolean;       // nickname / bio / gender / birthday
  usernameEdit: boolean;
  avatarUpload: boolean;
  smsLogin: boolean;
  qrLogin: boolean;
}

const BUILTIN_CAPABILITIES: AccountCapabilities = {
  profileEdit: false,
  usernameEdit: false,
  avatarUpload: false,
  smsLogin: false,
  qrLogin: false,
};

const PLATFORM_CAPABILITIES: AccountCapabilities = {
  profileEdit: true,
  usernameEdit: true,
  avatarUpload: true,
  smsLogin: true,
  qrLogin: true,
};
```

`useAccountCapabilities()` returns the active set. UI reads
`capabilities.profileEdit` to decide whether to render the
"Edit profile" button. This makes BUILTIN-only deployments
automatically hide everything that requires the platform layer
without per-call-site conditionals.

The capability matrix is also the gate for adding a new mode
later (e.g. an OIDC mode would set `profileEdit: false`,
`smsLogin: false`, `qrLogin: false`, `usernameEdit: false`).

## Post-login Required Actions (R8.4)

> **Full contract:** [PLATFORM_REQUIRED_ACTIONS_CONTRACT.md](./PLATFORM_REQUIRED_ACTIONS_CONTRACT.md).
> **Companion:** [PLATFORM_PROFILE_HTTP_CONTRACT.md](./PLATFORM_PROFILE_HTTP_CONTRACT.md) — profile API used by the first concrete action.
> **This section is the architectural slot** — what the framework is, where
> it lives in the layering, why it's a generic platform mechanism rather
> than a profile-specific gate.

R8.4 introduces a cross-cutting mechanism: **before any user reaches
ChatWorkspace, the server may declare a list of required actions that
the user must complete first**. v1's only concrete action is
`complete_profile.nickname` (so users don't show up as `Member_xxxx` /
`user_xxxxxxx` to others). The framework is designed to absorb future
needs without re-architecting:

- accept new terms of service / privacy policy version
- bind a mobile number (e.g. social-login + missing phone)
- verify email
- complete KYC at a given level
- acknowledge an operations-pushed notice
- forced password reset after risk event

### Where it lives in the layering

```
┌────────────────────────────────────────┐
│  Auth layer (R8.3)                     │
│  PlatformAuthProvider → /auth/*        │
│  → returns LoginResponse               │
└─────────────┬──────────────────────────┘
              │  loginResult.requiredActions: RequiredAction[]
              ▼
┌────────────────────────────────────────┐
│  Required Actions framework (R8.4c)    │
│  App.tsx state machine; non-empty list │
│  → renders <RequiredActionFlow>        │
│  → dispatches to action sub-components │
│  → re-fetches GET /required-actions    │
│    after each completion               │
└─────────────┬──────────────────────────┘
              │ list returns []
              ▼
┌────────────────────────────────────────┐
│  Concrete actions (R8.4c+)             │
│  v1: <CompleteProfileAction>           │
│       → ProfileProvider.updateNickname │
│  R8.5+: <AcceptTermsAction>,           │
│         <BindMobileAction>, ...        │
└─────────────┬──────────────────────────┘
              │
              ▼
┌────────────────────────────────────────┐
│  Profile / Terms / KYC providers       │
│  PlatformProfileProvider → /app/member/│
│  user/* (R8.4b)                        │
│  Future: TermsProvider / KycProvider   │
└────────────────────────────────────────┘
```

### Three core invariants

1. **Server is authoritative**: `loginResult.requiredActions` for fresh
   logins; `GET /app/account/required-actions` for everything else.
   Client never invents/caches its own list. After completing one
   action, client **re-fetches** to learn what's next (server may
   have added more actions in between).
2. **Token unchanged**: tokens are issued normally regardless of
   pending actions. The user can call `updateNickname` (and any
   future action's API) precisely because they have a valid token.
   The gate is **client-side UI blocking**, not server-side auth
   refusal.
3. **Single completion path per action**: each action has exactly one
   way to be marked done — calling its specific update API and getting
   a success. UI does not "trust user input"; framework re-fetches
   the authoritative list to confirm.

### Why not bool, not auth, not SDK

- **Not a single bool** (early R8.4a draft used `requires_profile_completion: bool`):
  insufficient for accept_terms / KYC / risk-reset / acknowledge_notice;
  promoting to an open `RequiredAction[]` list before any code ships
  avoids architectural debt.
- **Not auth**: required actions are platform-layer concerns. Coupling
  them into auth (server refusing to issue tokens) breaks the ability
  to call the actions' update APIs.
- **Not SDK**: `@privchat/sdk` deals with IM channel, not platform
  required actions. The framework lives entirely in the application
  HTTP layer + Web UI gate.

### Cross-mode design

The framework is mode-agnostic. v1 only PLATFORM activates it (server
returns `complete_profile` for SMS auto-register paths). BUILTIN
returns `[]` because BUILTIN register already requires the user to
actively choose a username. If a future mode (enterprise SSO, imported
users, etc.) needs the same framework, the server populates
`requiredActions`; client code is unchanged.

### Unknown action handling

Each `RequiredAction` carries `required: boolean`. When client doesn't
recognize the `type`:
- `required: true` → **fail-closed**, render "client needs upgrade" page
- `required: false` → **silent skip**, continue with the rest

This is a deliberate safety choice: silent-skipping required actions
would let clients bypass server-mandated platform contracts (e.g.
service-agreement updates).

### Persistence and multi-account

- localStorage key: `privchat.web.required-actions-pending.<accountKey>`
- Per-account isolated; switching to a clear account doesn't show the
  flow; switching to a pending one does.
- Refresh / close-tab cannot bypass the framework (flag persists; auto-
  login re-confirms via `provider.list()`).

### Naming history

This mechanism went through three names during R8.4a contract drafting:
1. **first-login nickname onboarding gate** — PLATFORM-specific, narrowest scope
2. **profile completion gate** (with `requires_profile_completion: bool`) — generalized to any-mode but still profile-specific
3. **Post-login Required Actions** (with `requiredActions: RequiredAction[]`) — fully generic, profile completion is just the first concrete action

Final name and contract are #3. Drafts #1 and #2 do not appear in any
shipped code. The `requiredActions` field name and `required-actions-pending`
localStorage key reflect the final mechanism.

## QR login state machine

QR login only renders under `capabilities.qrLogin === true` (i.e.
PLATFORM mode). Web is the **target** of the login (the device
being logged in to); the App is the scanner. The full protocol is
in `spec/05-feature/QR_LOGIN_SPEC.md`; below is the Web-side
state machine.

```
                ┌────────────┐
                │    idle    │  ← no scene yet
                └─────┬──────┘
                      │ user opens QR tab
                      ▼
                ┌────────────────┐
                │ creatingScene  │
                └─┬─────────────┬┘
            error │             │ scene id + qr_token
                  ▼             ▼
            ┌─────────┐   ┌─────────────────┐
            │ failed  │   │ waitingForScan  │ ← QR rendered
            └─────────┘   └────┬───────┬────┘
                               │       │
                  qr_login.expired   qr_login.scanned
                               │       │
                               ▼       ▼
                       ┌─────────┐   ┌──────────┐
                       │ expired │   │ scanned  │
                       └────┬────┘   └────┬─────┘
                            │ auto retry  │
                            └─→ creatingScene
                                         │ qr_login.authorized
                                         ▼
                                   ┌──────────┐
                                   │confirmed │
                                   └────┬─────┘
                                        │  parse data → LoginResult
                                        │  → store session via R7.2a
                                        │  → authenticate IM ws
                                        ▼
                                  (handed off to App.tsx
                                   regular post-login flow)

           any state ──┐
                       │ user navigates away / closes tab
                       ▼
                  ┌────────────┐
                  │ cancelled  │  → unauth ws closes,
                  └────────────┘     server unbind_by_session
```

Error state from any of: scene creation failed, push contained
unparseable `MemberLoginResponse`, IM auth handshake failed.

Implementation notes:

- The unauth WebSocket lives **only** while QR login is on screen.
  Idle / confirmed / cancelled → close.
- `expired` auto-restarts. We do NOT prompt the user to click
  "refresh QR" — match the spec's UX guidance (§7).
- `scanned` is a one-way transition; we don't go back to
  `waitingForScan` if the user lingers. The App must explicitly
  reject (which arrives as `qr_login.rejected`) for the scene to
  end without a confirm.
- The post-`confirmed` step funnels through the same code path as
  password/SMS login — `LoginResult` is the single converging
  shape.

The QR rendering library choice (e.g. `qrcode-svg` vs `qrcode.js`
vs canvas-only) is out of scope here; pick when implementing R8.5,
preferring the smallest dep that ships pure SVG output.

## R7 multi-account compatibility

R7's registry + per-account session blobs already exist. R8 grows
both shapes. Backward-compat reads are required because R7.2a's
migration runner is already in production for some users.

### `AccountEntry` (amended R8.2c)

```diff
 export interface AccountEntry {
   url: string;
   user_id: string;
   device_id: string;
   alias?: string;
   color?: string;
   added_at: number;
+  /** R8 — which account system this entry comes from. Reads
+   *  default to `'builtin'` for entries written before R8.1. */
+  mode?: AccountMode;
+  /** R8 — present iff mode === 'platform'. R8.2c decision:
+   *  PLATFORM login MUST persist this field, so auto-login and
+   *  refresh can reconstruct the provider without re-reading
+   *  env. Future-proofs the day a build holds accounts from
+   *  multiple platform deployments. Schema-optional (downgrade
+   *  safe), runtime-required for PLATFORM. */
+  platform_base_url?: string;
 }
```

Reader rule: a missing `mode` is treated as `'builtin'`. R8.1
must NOT migrate older entries into v2 with `mode: 'builtin'`
explicitly written — keep them shape-compatible so a downgrade
path is clean.

### `PersistedSession` (amended R8.2c)

```diff
 export interface PersistedSession {
   url: string;
   user_id: string;
   access_token: string;
   device_id: string;
   saved_at: number;
+  /** R8 — bound at save time so the auth provider can be picked
+   *  on next boot without reading the registry twice. Defaults
+   *  to `'builtin'` when missing. */
+  account_mode?: AccountMode;
+  /** R8 — present iff account_mode === 'platform'. R8.2c: MUST
+   *  be written on every PLATFORM login (see AccountEntry note
+   *  above for rationale). Schema-optional, runtime-required
+   *  for PLATFORM refresh path. */
+  platform_base_url?: string;
+  /** R8 — PLATFORM provider's refresh token (server-signed
+   *  RS256 JWT, paired with access_token). BUILTIN today
+   *  doesn't issue a separate refresh token. */
+  refresh_token?: string;
 }
```

> **R8.2c invariant:** if `account_mode === 'platform'`, both
> `platform_base_url` and `refresh_token` MUST be present. PLATFORM
> provider's `refreshToken()` will throw if either is missing —
> caller should clear the session and force re-login.

### AccountKey unchanged for v1

Per the "one platform authority per server_url" assumption above,
`accountKeyFor(url, user_id)` stays as-is. R8.1 adds a TODO comment
and design-note pointer in `account-key.ts`.

### Registry-of-one migration

R7.2a's existing migration runner doesn't need to know about R8.
A user upgrading from R7.2 → R8.1 carries a registry entry without
`mode`; the new `AccountAuthProvider` factory reads the entry and
treats missing-mode as `'builtin'`. No second migration is required
unless the user explicitly logs into a PLATFORM-mode build of the
app, in which case fresh-login writes the new fields naturally.

## Rollout plan (amended R8.2c)

| Step | State | Description |
|------|-------|-------------|
| R8.0 | shipped | docs(web): this design note |
| R8.1 | shipped | refactor(web): introduce `AccountAuthProvider` + `AccountProfileProvider` + `AccountCapabilities`; default `BuiltinAuthProvider` wired in; **no UI behavior change**; existing username+password flow goes through the new provider |
| R8.2 | shipped | refactor(web): LoginPage routed through provider; BUILTIN regression smokes (3 cases) cover provider resolution + temp-client lifecycle + LoginPage re-mount under add-account flow |
| R8.2b | shipped | docs(web): freeze platform auth HTTP contract — see [PLATFORM_AUTH_HTTP_CONTRACT.md](./PLATFORM_AUTH_HTTP_CONTRACT.md) |
| R8.2c | shipped | docs(web): align this design note with the HTTP contract; resolve token-model / register / password-UI / persistence questions |
| R8.3a | shipped | feat(web): `PlatformAuthProvider` HTTP envelope client — `{code,message,data}` decode, baseUrl normalize, error normalization. Interface-level: added `sendSmsCode?` to `AccountAuthProvider`. **In-flight scope expanded to include `loginWithSms` + `refreshToken` implementations** (originally R8.3b's first half) so the provider shipped fully usable in one PR. 7 smoke cases. |
| R8.3b | shipped | feat(web): LoginPage capability-gated SMS UI — under `capabilities.smsLogin === true`, renders mobile + smsCode form with 60s local cooldown; success persists `account_mode` / `platform_base_url` / `refresh_token` to BOTH session blob AND registry entry (R7/R8 invariant). BUILTIN path unchanged. 5 smoke cases. |
| ~~R8.3c~~ | absorbed | ~~UI was originally split off~~ — R8.3b shipped the SMS form together with the provider hookup since the form is the only consumer of the seam. No separate PR needed; tracked here for plan coherence. |
| R8.3d | optional / not planned | feat(web): PLATFORM password login UI — only if product reopens R8.2c §3 decision. Native PLATFORM clients still don't expose password; Web v1 mirrors that. |
| R8.4a | shipped | docs(web): two contract documents — [PLATFORM_PROFILE_HTTP_CONTRACT.md](./PLATFORM_PROFILE_HTTP_CONTRACT.md) (member profile API) + [PLATFORM_REQUIRED_ACTIONS_CONTRACT.md](./PLATFORM_REQUIRED_ACTIONS_CONTRACT.md) (cross-cutting Post-login Required Actions framework). Mid-round design upgrade: `requires_profile_completion: bool` was replaced before shipping with `requiredActions: RequiredAction[]` to support future actions (accept_terms / KYC / etc.) without re-architecting |
| R8.4a-server | shipped | feat(application) **shipped 2026-05-11**: (1) `RequiredAction` DTO with `action / required / title / titleKey / fields / version / noticeId / reason`; (2) `MemberLoginResponse.requiredActions: List<RequiredAction> = emptyList()`; (3) `logic.RequiredActionsLogic.computeForUid / computeForMember / isProfileIncomplete` (v1 nickname-pattern fallback); (4) Controller `controller.app.required_actions.RequiredActionsController` (package name avoids FQN clash with `module-platform`'s existing `controller.app.account.AccountController`) at `GET /app/account/required-actions`; (5) `MemberAuthLogic.buildResponse` + `refreshToken` inject actions. No DB migration. v1 returns `{action:"complete_profile", required:true, title:"设置昵称", titleKey:"requiredAction.completeProfile.nickname", fields:["nickname"]}` for default-nickname members. **curl 6/6 verification cases pass** |
| R8.4b | shipped | feat(web): two providers — `PlatformProfileProvider` (`getProfile` + `updateNickname` required, others stubbed for R8.4d) + `RequiredActionsProvider` (PLATFORM HTTP `list()` impl + BUILTIN noop). 9-case smoke |
| R8.4c | shipped | feat(web): `RequiredActionsGate` + `<CompleteProfileAction>` + `<UnsupportedRequiredActionPage>` — `App.tsx` blocks ChatWorkspace whenever `loginResult.requiredActions.length > 0` OR `provider.list()` returns non-empty OR localStorage `required-actions-pending` flag set; v1 only handles `complete_profile.nickname`; unknown action with `required: true` → fail-closed; 13-case smoke |
| R8.4d-1 | shipped | feat(web): `<ProfileEditDialog>` self-edit affordance in `ProfileCard`; `PlatformProfileProvider.updateBio / updateGender / updateBirthday` HTTP impls; per-field diff PUT for nickname/bio/gender/birthday; 9-case smoke |
| R8.4d-2 | shipped | feat(web): avatar `uploadAvatar` (multipart `/infra/file/upload`, single `/app`) + `updateAvatar` (`/app/app/member/user/update-avatar`); client mime/size guards; local blob preview; 9-case smoke |
| ~~R8.4d-3~~ | deferred | username editor; not a Required Action surface — independent round when needed |
| R8.4e | future | feat(web): additional concrete actions (`accept_terms`, `bind_mobile`, `acknowledge_notice`, `complete_kyc`, etc.) plug into the framework as new `<XxxAction>` components without changing R8.4c's outer state machine |
| R8.5a | shipped | docs(web): freeze QR login wire — [PLATFORM_QR_LOGIN_CONTRACT.md](./PLATFORM_QR_LOGIN_CONTRACT.md). Pinned: Web ↔ privchat-server is unauth RPC (`qr_login/create_scene` + 4 push topics on the same unauth WebSocket); Web ↔ application is HTTP only for post-authorized routes; QR canvas payload is JSON envelope `{sceneId, qrToken}` (not raw `qr_token`) so the App scanner can recover both fields; `authorized.data` = `MemberLoginResponse`; PLATFORM-only capability gate |
| R8.5b | shipped | feat(web): `PlatformAuthProvider.startQrLogin()` over the existing SDK unauth WS RPC + `onPushMessage` push bus (zero SDK changes). State machine surface: `QrLoginSession { scene, subscribe, cancel }`; events `scanned / rejected / expired / authorized`. Multi-listener `pushCbs` Set + identity-checked unsub fixes StrictMode race. 16 smoke cases (BUILTIN gate absent, PLATFORM exposed, RPC mapping, all 4 push events, sceneId filter, cancel/dispose, RPC/connect failures, malformed payload silent-expire, foreign topic ignored, etc.) |
| R8.5c | shipped | feat(web): LoginPage QR tab (PLATFORM-only) — SMS / QR segmented control, full 8-state machine, `QRCode.toCanvas` rendering, countdown, regenerate, `getActiveQrUnauthClientFactory` test seam for harness-driven scripted factory. 7 UI smokes (gate absent on BUILTIN, tab toggle default SMS, click QR → connect+RPC fired, authorized push → onLoggedIn unmounts panel, expired push → regenerate, regenerate restarts, RPC fail → error UI with retry). i18n zh-CN / en / vi 17 keys. Bundle delta ≈ +12 KB gzip (qrcode lib + panel) |
| R8.5d | shipped | docs(web): smoke close-out + cross-repo verification record — see §R8.5d Close-out below. Full chain verified end-to-end on Android in [R8.6c]; `qr_login.scanned` / `qr_login.authorized` push pipeline confirmed Web-side via real device. Web smokes 23/23 pass. No code change in this round |
| R8.6 | spans privchat-app | App-side QR scanner rounds — tracked in [privchat-app docs](../../privchat-app/docs/QR_SCANNER_ROUND_NOTES.md) so this Web design note doesn't carry App-internal round detail. R8.6a (HTTP scaffold) / R8.6b-rust (rxing decoder in SDK) / R8.6c (Android Kuikly embedded scanner, complete) all shipped; R8.6c-geo / R8.6d-ios / R8.6e-polish open |

Each step gates on the existing project gate:

```
pnpm check:i18n
pnpm typecheck
pnpm build
pnpm test:e2e
pnpm test:e2e:virtual
```

R8.6 likely adds a `pnpm test:e2e:platform` flavour analogous to
`test:e2e:virtual`, with platform endpoints stubbed by the harness.

## Open questions (amended R8.2c)

R8.2c resolves Q2 directly and confirms Q1's "lean NO" as decided.
Q3–Q6 are R8.4 / R8.5 concerns and carry forward unchanged.

1. ~~Does PLATFORM mode allow a single Web build to register accounts
   from BOTH systems in the registry?~~ **Decided in R8.2c: NO.** One
   Vite build = one mode = one system. Confirmed by `mode` being a
   compile-time env var, not a per-account toggle. Cross-mode
   coexistence is out of scope for R8 entirely.
2. ~~SMS code resend cooldown UX.~~ **Resolved in R8.2c.** UI uses a
   60s local timer (returned via `SendSmsCodeResult.cooldownSeconds`
   from the provider, default 60 in v1). Server doesn't return a
   Retry-After today; if it ever does, the provider can override the
   default. See PLATFORM_AUTH_HTTP_CONTRACT.md §6.3.
3. **Avatar upload progress.** (R8.4) Reuse the existing
   `uploads-store.ts` pattern, or a one-off "saving avatar..."
   spinner? The pattern is heavier than this needs; one-off is
   cleaner.
4. **QR refresh policy on tab visibility change.** (R8.5) Spec says
   auto-refresh on `expired`. But also tab-blur / tab-revisit —
   should we proactively re-create on blur+revisit, or trust the
   existing 90s server TTL? Lean toward "trust TTL + auto-refresh
   on `expired` event"; no extra visibility logic.
5. **Profile editor surface** — (R8.4) single dialog vs. tabbed
   page? Lean toward single dialog under the existing avatar / name
   click in the chat header.
6. **`username` immutability.** (R8.4) In some PrivChat deployments
   `username` is set-once. The platform endpoint probably enforces
   this server-side. UI policy: show the field as editable, surface
   server error on attempted change. Don't try to predict the
   policy client-side.

## Out of scope (amended R8.2c)

To keep R8 scope honest:

- BUILTIN-mode profile editing (server endpoint is a stub; design
  note will revisit if it ships)
- **PLATFORM password login UI in Web v1** (R8.2c §3 decision —
  endpoint exists, native client doesn't use it; Web mirrors that
  to avoid inventing a divergent auth surface. Reopen via R8.3d
  only if product asks for it)
- **PLATFORM independent register UI** (R8.2c §2 — no such
  endpoint; SMS-login auto-registers)
- Any password recovery flow (separate round if/when needed —
  scene 4 `MEMBER_RESET_PASSWORD` exists server-side but Web v1
  does not surface it)
- Server-side single-device or all-device logout (R8 v1 does not
  call `/auth/logout` even though it exists; `clearSession()`
  localStorage wipe is sufficient for the current UX)
- Bot login under either mode (different account class entirely)
- Multi-platform-per-server registry (covered by the AccountKey
  caveat above; not needed today)
- E2EE key migration across mode boundaries
- Mobile / native parity for the QR scanner side (lives in
  `privchat-app`)

## §R8.5d Close-out

Round R8.5d is a documentation-only round: no Web code change. It
records that R8.5a / R8.5b / R8.5c have been validated end-to-end
through a real App scanner (R8.6c on Android), and freezes the wire
decisions that came out of cross-repo integration.

### What was verified

- **Web ↔ server unauth WebSocket RPC** (`qr_login/create_scene` +
  4 push topics) confirmed working in production-shape Web build,
  Android scanner driving it. The earlier HTTP-polling hypothesis in
  R8.5a's first draft was wrong — corrected before R8.5b shipped.
- **JSON envelope payload** `{sceneId, qrToken}` (encoded into the QR
  canvas) confirmed correct: the App scanner parses both fields out
  of the QR string and forwards `(sceneId, qrToken)` to
  `POST /app/platform/qr-login/scan`. Raw `qr_token` alone is not
  enough — application requires `scene_id` in the scan call.
- **`authorized.data` shape** = full `MemberLoginResponse` (same as
  SMS login). Web reuses the existing `onLoggedIn` path; no QR-only
  branch in session persistence.
- **`scanned` push** triggers Web UI transition to "已扫码，等待确认".
  **`authorized` push** triggers Web to call `onLoggedIn` and unmount
  the panel. **`rejected` / `expired`** transition to terminal states
  and offer regenerate. All four observed live on Android.

### Smoke status

| Suite | Cases | Status |
|-------|-------|--------|
| `platform-qr-login.spec.ts` | 16 | pass |
| `platform-qr-login-ui.spec.ts` | 7 | pass |
| **total R8.5 QR** | **23** | **23/23** |

Existing R8.0–R8.4 suites untouched and still green.

### Decisions frozen in this round

1. QR canvas payload format is JSON envelope, not raw token. Any
   future re-introduction of a non-JSON encoding requires an App
   scanner update — flag in spec before changing.
2. `account_mode === 'PLATFORM'` is the single capability gate for
   the QR tab; the LoginPage QR segmented control is hidden in
   BUILTIN. App-side has the symmetric gate
   (`PlatformQrLoginApiFactory.createOrNull` returns null in
   BUILTIN).
3. R8.5 closes the Web side of QR login. Subsequent QR work
   (geo-IP enrichment, iOS scanner, polish) is App-/server-side
   only — Web does not need to re-ship unless the wire contract
   changes.

### Cross-repo references

- **App-side rounds**: see [privchat-app QR scanner round notes](../../privchat-app/docs/QR_SCANNER_ROUND_NOTES.md)
  (R8.6a / R8.6b-rust / R8.6c shipped; R8.6c-geo / R8.6d-ios /
  R8.6e-polish open).
- **Wire contract**: see [PLATFORM_QR_LOGIN_CONTRACT.md](./PLATFORM_QR_LOGIN_CONTRACT.md).
- **HTTP contract** (scan / confirm / reject): see
  [PLATFORM_AUTH_HTTP_CONTRACT.md](./PLATFORM_AUTH_HTTP_CONTRACT.md)
  §QR sections.
