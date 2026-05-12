# Virtual Timeline Design (R5)

Design note frozen **before** implementation. The point of this
document is to commit to a strategy on the hard parts (anchoring,
dynamic height, reply jump, local-echo replacement) so the
implementation PRs don't re-litigate them in code review.

## Status

Design draft. R5.0 — not yet implemented.

## Goal

Support large message lists in `ConversationPanel` (10k+ rows in a
single channel) without breaking the established chat-scroll
semantics:

- "open at bottom" on first visit
- restore the previous read position on revisit
- prepend older history when scrolling up, with no visible jump
- reply-quote → scroll + flash the original row
- send / receive scrolls to bottom only when the user is already
  near the bottom

The win is render cost: today the panel renders every row in the
channel as soon as it's loaded. Group channels and long DMs are the
first places this hurts.

## Non-goals

These are explicitly **not** part of R5:

- Message search / find-in-conversation
- Cross-channel virtualization or shared row cache
- Full timeline rewrite (we keep `MessageRow` and friends)
- R7 multi-account changes — token / IDB namespace / websocket
  ownership stays exactly as it is
- Recording or media-capture changes (see VOICE_V1_PLAYBACK_ONLY)

If a sub-task starts pulling in any of the above, stop — that's a
different round.

## Message identity

Virtualization is **only** safe when each row has a stable key
across the row's full lifecycle (pending → sent → server-acked →
maybe revoked). Anchoring uses this key, not array index.

| State | Key |
|-------|-----|
| Remote (received or post-ACK) | `server_message_id` |
| Local echo (pending, pre-ACK) | `local:<local_message_id>` |
| Failed outbox row | same as local echo (`local_message_id`) |

This is already the contract on `MessageItemVM.record_key`. R5
must NOT introduce a different key.

## Anchor model

A scroll position is `(anchor_message_key, offset_from_top)`:

- `anchor_message_key` — `record_key` of the topmost row whose
  bottom edge is within the viewport
- `offset_from_top` — pixels from `viewport.top` to that row's top
  (negative if the row's top is above the viewport)

The current panel already uses this shape (`scroll-positions.ts`)
for cross-session restore. R5 reuses it for in-session prepend
anchoring too. **Never anchor on raw `scrollTop`** — height
changes (image decode, reaction added, revoke) invalidate it.

## Initial render

- First open of a channel:
  - if `loadScrollAnchor(channelId)` returns an anchor, scroll to
    that anchor
  - else scroll to bottom (latest message)
- Switching back to a previously-opened channel: same rule — saved
  anchor wins, otherwise bottom

## History prepend

When `loadOlder()` resolves and prepends rows:

1. **Before** the prepend, capture the current anchor:
   `(top_visible_record_key, offset_from_top)`.
2. After React commits the new rows, scroll the virtualizer so the
   same `record_key` lands at the same `offset_from_top`.

This preserves the user's perceived position even though the index
of every existing row shifted. The current panel does a related
trick (capture `scrollHeight` delta); R5 must replace it with the
key-based approach because the virtualizer's index space is
opaque.

## Dynamic height

Rows can change height after first render. Sources of change:

- Image bubble — `<img>` decode flips from "aspect-ratio box" to
  actual rendered box
- File / voice bubble — async metadata load can affect filename /
  duration label width
- Reaction chips — added or removed
- Reply quote — original row resolves and quote header expands
- Revoke — full bubble swaps to a one-line placeholder

Strategy:

- Use **measured row heights** (the virtualizer measures DOM, we
  don't pre-compute). `@tanstack/react-virtual`'s
  `measureElement` covers this.
- After a measured height change, **re-anchor** so the row that
  was on screen stays on screen. Without this, an image decoding
  100px above the viewport will visually shove the active row
  down.

## Reply jump

Reply-quote click resolves a target `record_key`. Three cases:

1. **Target is currently mounted (in the rendered window):**
   - `scrollIntoView` with `block: 'center'`
   - Apply `data-flash` highlight class (the existing animation)
2. **Target is loaded in cache but outside the rendered window:**
   - Find target's index in the row array
   - `virtualizer.scrollToIndex(index, { align: 'center' })`
   - Wait one frame for mount, then highlight
3. **Target is not in cache (older than what we've loaded):**
   - Show the "原消息已失效" placeholder (existing behavior — we
     do NOT add a "fetch this single message" path; that decision
     was frozen in `project_reply_local_only`)

## Local echo replacement

When the SDK swaps a local-echo row in place (ACK arrives,
`local_message_id` → `server_message_id`), the cache emits an
upsert that may change the row's key (depending on which projection
strategy R5 picks).

Constraints:

- **Visual position must not jump.** The row's pixel position in
  the viewport stays the same.
- The row's measured height should not flicker — the bubble's DOM
  is unchanged, only the underlying record id swaps.

Strategy: `record_key` stays `server_message_id` for both the
final row and (if a `local:` key was used during pending) the
prior pending row, but the projection re-uses the `local:` key
during the brief pending → ACKed window so React reconciles
in-place. This already matches `MessageItemVM.record_key`'s
documented behavior — we just have to be careful the virtualizer
keys on the same field.

## Reactions

Reaction chips changing is the most common dynamic-height event.
Two rules:

- The reaction strip is part of the same virtual row (one row =
  one message, regardless of reaction state). No separate virtual
  rows for reactions.
- When chip count changes, lean on the `measureElement` re-flow
  + the dynamic-height re-anchor described above.

## Revoke

Revoke replaces a bubble with a one-line system-style note. The
height change is large (often 60-90px → 24px). Handle via the
generic dynamic-height path; no special case.

## Unread marker

If/when an "unread divider" is introduced, it participates as a
**virtual row with a stable key** (`unread:<channel_id>` or
similar). It is NOT a layout effect on the row above — that
breaks anchoring.

For R5.0, no unread marker is added; this section is forward-
compatibility only.

## Mobile / single-pane

The mobile single-pane view already mounts/unmounts the
`ConversationPanel` on tab switch. The virtualizer must handle
this — i.e. scroll position and measured-height cache should
either persist via the existing `scroll-positions.ts` anchor (for
the revisit case) or rebuild cheaply from the measured heights.

We do NOT introduce a separate "mobile virtualization" code path.

## Feature flag

R5 ships behind:

```
VITE_PRIVCHAT_VIRTUAL_TIMELINE=1
```

Default off until the smoke suite, manual testing on real groups,
and dev-mode for one full week show no regressions. Then we flip
the default and remove the flag.

## Technology

**Preferred:** `@tanstack/react-virtual`

Reasons:
- Dynamic measured heights are first-class (`measureElement`)
- We control the scroll element (we already own the scroll
  container in `ConversationPanel`)
- Tiny dependency, no opinionated styling
- Works with React 19

**Fallback:** custom simple windowing (top/bottom buffer,
`IntersectionObserver` to expand) if the integration risk on
`@tanstack/react-virtual` proves too high (e.g. anchor restore
becomes brittle after prepend). Decide at the end of R5.1.

We are explicitly **not** considering `react-window` first — it
shines for fixed-height lists and chat timelines are the opposite.

## Commit plan

| Step | Description |
|------|-------------|
| R5.0 | docs(web): add virtual timeline design note (this doc) |
| R5.1 | refactor(web): isolate `MessageList` render pipeline (no behavior change, prepares the seam) |
| R5.2 | feat(web): add virtual timeline behind `VITE_PRIVCHAT_VIRTUAL_TIMELINE` |
| R5.3 | fix(web): preserve scroll anchor on history prepend and on session restore |
| R5.4 | feat(web): support reply jump + highlight in virtual timeline |
| R5.5 | test(web): smoke coverage for the four critical paths (open at bottom, prepend, reply jump, dynamic height after image decode) |

Each step gates on:
```
pnpm check:i18n
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Out of scope

Everything not listed under "Goal" or in the commit plan above.
In particular:

- R7 multi-account
- voice recording
- search
- thread / forum-style sub-views

If one of these becomes pressing during R5, fork off a separate
round; do not graft it into R5 PRs.
