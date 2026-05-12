# Multi-Account Design Note (R7)

Design note frozen **before** implementation. The point of this
document is to commit to a strategy on the hard parts (SDK
lifecycle, persistence namespacing, websocket ownership, in-flight
operations across switches) so the implementation PRs don't
re-litigate them in code review — and so we can spot the real cost
of multi-account before we start writing the code.

## Status

Design draft. R7.0 — not yet implemented. R5 (virtual timeline) is
the prerequisite work; R7 is the next big-ticket round once R5
dogfood lands.

## Goal

Let one browser tab hold credentials for multiple PrivChat accounts
and switch the active session at runtime, without:

- losing in-flight outbox rows,
- corrupting either account's local cache,
- leaking either account's data into the other's UI,
- requiring a full page reload.

The motivating use case is the dual-account dogfood pattern (work
account + personal account in the same window) and operations /
support roles that need to drive several accounts.

## Non-goals

These are explicitly **not** R7:

- Multi-org / workspace sharding within a single account
- Federation or cross-account messaging
- Guest / anonymous mode
- Simultaneous foreground rendering of more than one account (we
  always have exactly one ACTIVE account; others are dormant)
- Shared views (e.g. "all accounts' unread") — would need a
  cross-account aggregator that doesn't exist
- Per-account E2EE key migration (separate piece of work; for now
  each account keeps its own keystore independently)
- Mobile/native lifecycle parity (Kotlin / Swift SDKs are out of
  scope for this round)

If a sub-task starts pulling in any of the above, stop — that's a
different round.

## Single-account baseline (what's there now)

R7's plan starts from the current state. Everything below is
**single-account today**:

- One `PrivchatClient` instance, constructed once after login
  (`createPrivchat()` in `src/lib/privchat-client.ts`).
- One `PrivchatProvider` mounted at the React root, with `adapter`
  bound to the single client.
- One Dexie DB, hard-coded name `privchat-web-dev`.
- One `localStorage` blob at key `privchat.web.session` carrying
  `{ url, user_id, access_token, device_id, saved_at }`.
- One WebSocket owned by the client.
- Module-level singletons in `src/features/chat`:
  - `voice-playback.ts` — single `<audio>` controller
  - `uploads-store.ts` — single upload-task map
  - `scroll-positions.ts` — single channelId → anchor map
  - `error-reporter.ts` — single capture sink
  - `log-buffer.ts` — single log ring
- A handful of localStorage scratch keys (notify settings, theme).

This whole stack assumes "one user_id at a time". R7 either
namespaces those assumptions or relocates them under an
account-keyed registry.

## Identity model

An **account** is uniquely identified by:

```
AccountKey = sha256(`${gateway_url}|${user_id}`).substring(0, 16)
```

Why hashed:
- `user_id` alone collides across gateways (two users with the
  same id on different servers).
- Hashing gives a short, filename-safe, log-safe key we can use as
  Dexie DB name suffix and localStorage namespace.
- 16 hex chars (64 bits) is collision-safe in the small-N regime.

`AccountKey` does NOT change when the access token rotates. The
identity is stable across reconnects, refresh-token cycles, and
device reauths.

## Active account vs registry

Two separate concepts:

- **AccountRegistry** — the set of all known accounts in this
  browser. Persisted in localStorage, shape:
  ```
  {
    accounts: { [accountKey]: { url, user_id, device_id, alias?, color? } },
    active: AccountKey | null,
  }
  ```
  Tokens are NOT in the registry — they live per-account (see
  Token storage below).

- **ActiveAccount** — exactly one of the entries in the registry
  is "active" at any time. The active account drives the UI, owns
  the live WebSocket, and consumes desktop notifications normally.
  Inactive accounts are dormant: no React subscription, no live
  websocket.

The active account is mostly invisible to existing UI code — the
existing `PrivchatProvider` consumes the active client / adapter
and the rest of the tree uses it as before. Switching accounts is
an unmount/remount of the provider subtree (see Account switch
state reset below).

## SDK lifecycle

For each account in the registry, R7 holds a logical "session
slot" with a small state machine:

| State | Meaning |
|-------|---------|
| `dormant` | Registered, no client constructed. Default for inactive accounts. |
| `loading` | Client being constructed + auto-login in flight. |
| `live` | Active account; client is connected and authenticated. |
| `error` | Client construction or auto-login failed. UI surfaces a per-account "reauth" affordance. |

Transitions:

- `dormant → loading`: user picks the account from the switcher.
- `loading → live`: auto-login succeeds, client transitions to
  `authenticated`.
- `live → dormant`: user switches AWAY. The previous account's
  client is `disconnect()`ed and `dispose()`d to free the
  websocket; its localStorage entry stays so the next switch can
  resume.
- `live → error`: token expired AND refresh fails.

**One live client at a time.** The simplest model. No background
clients, no second websocket. R7 deliberately avoids "background
sync for inactive accounts" — that's a much bigger feature
(silent inbound-while-dormant, cross-account unread aggregator)
and explicitly out of scope.

The cost: switching to an inactive account incurs a fresh
connect + auth + bootstrap roundtrip. Acceptable at switch
frequency of ≤ a few per minute.

## Token storage

One token blob per account, stored under a namespaced
localStorage key:

```
privchat.web.session.<accountKey>  →  PersistedSession (existing shape)
```

The legacy single-account key `privchat.web.session` becomes a
**migration source only**:
- On first R7 boot, if the legacy key exists and the registry is
  empty, we create a registry entry from it and mirror it to the
  namespaced key, then delete the legacy key.
- The migration is one-shot; subsequent boots use only the
  namespaced keys.

Refresh-token rotation continues to work per-account; the rotated
value writes back to the same namespaced key.

## IDB namespacing

Each account owns its own Dexie DB. Naming:

```
privchat-web-<accountKey>
```

The current `privchat-web-dev` literal in
`src/lib/privchat-client.ts` becomes a fallback only used when
running the dev shell against an empty registry. Production uses
the namespaced form.

Migration: the legacy `privchat-web-dev` DB is renamed (Dexie
doesn't support rename — implement as "open the legacy DB, move
its tables into a fresh DB named `privchat-web-<accountKey>`,
delete the legacy DB"). One-shot, gated on the same migration
flag as the localStorage migration above.

Two accounts NEVER share an IDB. There is no "shared" cross-
account table — outbox rows, channel cache, message cache, friend
list, group list, attachments are all account-local.

## WebSocket ownership

Exactly one WebSocket is open at any time. It belongs to the
**active account**'s `PrivchatClient`.

- Switching accounts: tear down the live websocket via
  `client.disconnect()`, wait for the close handshake to settle
  (or timeout after 1s), then construct + connect the new
  account's client.
- Network blips: handled inside the active client, no R7-specific
  logic.
- Tab visibility: the existing single-account behavior carries
  over. R7 does not introduce per-account "stay connected when
  hidden" semantics.

This means **inactive accounts cannot deliver inbound messages
in real time**. When the user switches to an account, the
bootstrap phase reconciles missed history via the existing
`bootstrapChannels` + cursor mechanism. Acceptable for R7 v1;
"silent multi-account inbound" is a separate (much harder)
round.

## Outbox ownership

Outbox state is part of each account's IDB, so it's already
account-local. R7 only has to be careful about the ACTIVE outbox
engine:

- The outbox engine ticks via the live client's event loop.
  Inactive accounts' outbox rows are persisted but **not
  retried** while dormant. A failed row from yesterday on
  account B sits in B's IDB with `status='failed'` until the
  user activates B and clicks Retry.
- Switching FROM an account with outbox-pending rows: the engine
  is paused in-flight. When the user switches BACK, we resume
  from persisted state — no rows are lost; some may need a
  retry.

**Open question:** should switching show a small "N pending
sends in account X" badge on dormant accounts in the switcher?
Not strictly required for R7 v1, but easy to add and flags
forgotten outbox rows. Decide before R7.2.

## Pending upload cancellation

Uploads are tracked in the module-level `uploads-store.ts`.
That store is currently global and not account-keyed; R7 makes
it active-account-only. Concrete rule:

**On account switch, all in-flight upload XHRs are aborted and
their tasks marked `failed` with reason "switched away". The
underlying outbox row (if pre-created) keeps its content and
can be retried by the new active account... no, actually no:
the outbox row belongs to the OLD account (its IDB). The new
active account doesn't see it. Resuming requires switching
back.**

This is the cleanest cut. The alternative — keeping uploads
running across switches — would require either:
- A second websocket / HTTP client running for the inactive
  account (against the "one live client" rule), or
- Decoupling uploads from the SDK lifecycle (much larger
  refactor).

R7 v1 takes the cleanest cut: cancel-on-switch with a one-line
toast, "uploads in account X were cancelled — switch back to
retry". That's a known limitation we live with.

## Active-account-scoped module singletons

Today's module-level globals in `src/features/chat`:

| Module | What it holds | R7 strategy |
|--------|---------------|-------------|
| `voice-playback.ts` | Single `<audio>` + state | Cleared on switch (already is by `stopAll()` on conversation switch; we add the same on account switch) |
| `uploads-store.ts` | In-flight upload tasks | Cleared + xhr-aborted on switch |
| `scroll-positions.ts` | channelId → anchor | Namespaced under accountKey: keep a Map per accountKey, switch picks the right one |
| `error-reporter.ts` | Capture sink | Stays global. Each captured error tags `accountKey` so the sink can attribute. |
| `log-buffer.ts` | Log ring | Stays global. Lines tagged with `accountKey` at capture time. |

Pattern: anything that holds **per-channel** or **per-message**
state needs accountKey namespacing. Anything that's a sink or a
debug tool stays global but tags with accountKey.

## Account switch state reset

When the user switches from A to B, in this order:

1. **Stop active timers / streams.** `voice-playback.stopAll()`,
   abort in-flight upload XHRs.
2. **Disconnect A's websocket.** `clientA.disconnect()`. Wait up
   to 1s for clean close.
3. **Tear down React subtree under `PrivchatProvider`.** Provider
   is keyed by `accountKey` so changing the key unmounts the
   entire chat workspace. This is what guarantees no A-data
   leaks into B's render — every hook is freshly subscribed
   under B's adapter.
4. **Construct B's client / adapter.** `createPrivchat()` with
   B's `dbName` and `url`.
5. **Auto-login B.** Use B's persisted access token; on failure
   surface the per-account reauth UI.
6. **Mount B's `PrivchatProvider`.** Re-render. B's bootstrap
   roundtrip kicks off; the user sees a brief "loading" state
   before B's channel list lands.

Step 3 is the architectural commitment that makes this safe: by
unmounting and remounting, every per-channel hook, every
captured anchor, every `useSyncExternalStore` subscription is
fresh. We do NOT try to "reuse" any UI state across accounts.

## Notifications

Desktop notifications + sound are routed through the existing
`use-incoming-notifier.ts`. Today it's account-blind. R7
constraint:

- **Only the active account's inbound triggers a notification.**
  Inactive accounts can't deliver inbound at all (no live
  websocket), so this is automatically true at the SDK layer.
- The OS notification's "tab badge" / "title prefix" stays
  account-blind for v1. Cross-account unread is out of scope.

If a future round adds silent inactive-account inbound, the
notifier needs an `accountKey` filter so notifications can be
attributed and silenced per-account. That's a v2 problem.

## Account switcher UI

Out of scope for the design note, but the surface area:

- Sidebar bottom: avatar of the active account. Click → switcher
  popover.
- Switcher popover: list of registered accounts + "Add account"
  affordance. Picking one triggers the switch sequence above.
  Active account has a checkmark.
- Add account: takes the user to the existing login flow, which
  runs `createPrivchat()` against the entered URL and saves a
  new registry entry on success.
- Remove account: confirm dialog, then logout + delete the
  account's namespaced localStorage key + delete its IDB. The
  registry entry is also removed.

R7 v1 caps the registry at, say, 4 accounts to avoid edge cases
in switcher UX. Easy to relax later.

## What R7 does NOT need

To keep scope honest:

- No background workers, no service workers (PWA is a separate
  round).
- No cross-tab coordination via BroadcastChannel — each tab is
  its own switcher state. Two tabs CAN have different active
  accounts; that's allowed.
- No SDK API changes (the SDK already supports multi-instance
  use; we just have to ensure each instance gets its own DB
  name).
- No protocol changes. The server is account-agnostic; R7 is
  entirely client-side.

## Rollout plan

| Step | Description |
|------|-------------|
| R7.0 | docs(web): this design note |
| R7.1 | refactor(web): isolate account-scoped state — namespace `scroll-positions`, accept `accountKey` in `voice-playback`, define `AccountRegistry` shape; no behavior change yet |
| R7.2 | feat(web): single-account → registry-of-one migration; legacy localStorage + Dexie DB are migrated under an `accountKey`; behavior identical |
| R7.3 | feat(web): account switcher UI + add-account flow + active-account state machine; first switch works |
| R7.4 | fix(web): switch sequencing — voice-playback stop, uploads abort, websocket disconnect, provider remount; no leaks across switches |
| R7.5 | test(web): smoke coverage for: register two accounts, switch between them 5x, send + receive on each, retry failed outbox after switch back |

Each step gates on:
```
pnpm check:i18n
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:e2e:virtual
```

## Open questions (to resolve before R7.3)

1. **Switcher UX during loading.** When the user picks an account
   that's `dormant` and we transition to `loading`, do we block
   the UI with a spinner or render a "loading" placeholder for
   the chat workspace? Lean toward placeholder; don't block the
   sidebar.
2. **Pending outbox badge on dormant accounts.** See Outbox
   ownership above.
3. **What happens if the same `(url, user_id)` is registered
   twice from different login flows?** AccountKey collides so
   the registry entry is deduped. Token of the most recent login
   wins. Probably correct, worth a smoke.
4. **IDB version skew across accounts.** All accounts share the
   same SDK version, so all IDBs are at the same Dexie version.
   No skew expected; flag if it ever happens.
5. **Account remove: hard-delete vs archive.** R7 v1 uses hard-
   delete (clear localStorage + drop IDB). No "remove but keep
   history" archive mode in v1.
6. **Logout behavior.** "Logout" today clears the single session
   and returns to the login screen. R7: "Logout" is per-account.
   "Logout all accounts" is a separate destructive affordance.
7. **Feature flag during rollout.** Should R7 ship behind
   `VITE_PRIVCHAT_MULTI_ACCOUNT=1` like R5 did, or just be a
   mode where the registry has zero or one entries? Lean
   toward: no feature flag. The registry-of-one path is just the
   single-account experience. Two+ accounts is a runtime concept
   exposed by adding an account.

## Out of scope reminder

- Voice recording (R6 territory if/when we do it)
- Search
- Unread marker virtual row
- Multi-org / workspace
- Cross-account aggregators
- Guest mode
- Mobile / native parity
