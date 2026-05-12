# Virtual Timeline — Dogfood Checklist

Phased rollout plan + manual test checklist for the R5 virtualized
timeline. The flag is default OFF. Default ON only after a clean
dogfood round.

## Status

R5 implementation complete. Dogfood phase open.

## Phase plan

| Phase | Default | Plain path | Action to advance |
|-------|---------|------------|-------------------|
| 1 (now) | OFF | kept | run the checklist below for ≥ 1 week of real use; no regressions logged |
| 2 | ON | kept as fallback | flip `isVirtualTimelineEnabled()` default to true; PlainMessageList stays in the tree as a safe fallback while real-world usage hardens it |
| 3 (later) | ON | removed | only after Phase 2 has run for a few weeks with no anchor / scroll-physics regressions |

`PlainMessageList` carries near-zero maintenance cost — it's a thin
component over `MessageRow`. We keep it through Phase 2 deliberately
so a regression-during-dogfood can roll back instantly with a single
env var flip.

## How to enable for dogfood

```
VITE_PRIVCHAT_VIRTUAL_TIMELINE=1 pnpm dev
```

The flag is read at build/dev time via `import.meta.env`, so a Vite
restart is required after toggling. The two e2e gates correspond to
the two paths:

```
pnpm test:e2e            # plain path (10 specs)
pnpm test:e2e:virtual    # virtual path (16 specs)
```

## Checklist

Run each scenario manually at least once. Mark a regression if the
behavior described fails OR if scroll position visibly jumps,
flickers, or sticks unexpectedly. Anchor drift > ~16px in any of the
"position preserved" rows counts as a regression.

### 1. Long-form scrolling

- [ ] Pick a group with hundreds of messages. Scroll up and down for
      5–10 minutes continuously.
- [ ] Watch for: stalls, blank rows, content briefly disappearing,
      large jumps when fast-scrolling.

### 2. History prepend (load older)

- [ ] Scroll to mid-list. Click "Load older". The current visible
      row should not move more than a few pixels.
- [ ] Click "Load older" 3+ times in a row. Each load should
      preserve position.
- [ ] At the genuine beginning of history: button should turn into
      "— beginning —" and not bounce back.

### 3. Image-decode height drift

- [ ] Open a conversation with several images mid-list. Scroll to
      sit ABOVE the images, not at the bottom.
- [ ] Wait for images to finish decoding (the bubbles grow from
      placeholder to full size).
- [ ] The visible row at viewport top should not move noticeably.

### 4. Voice playback under scroll / channel-switch

- [ ] Tap a voice message to play it. Scroll up and down — playback
      should continue uninterrupted.
- [ ] Switch to a different conversation while playing — playback
      should stop (single-active controller) and the new
      conversation should park at its own position.

### 5. Reply quote — three states

- [ ] Click a reply quote whose original is currently in viewport →
      flash + smooth scroll, no big jump.
- [ ] Click a reply quote whose original is loaded but scrolled
      out of the rendered window → virtualizer should pull it in,
      flash on mount.
- [ ] Click a reply quote whose original is paged out / missing →
      inline "Original message not loaded in this window" toast,
      no scroll.

### 6. Failed retry / discard

- [ ] Force a send failure (e.g. flip the network off, then send).
- [ ] Click "Retry" — outbox cycles, position stays put.
- [ ] Click "Discard" on a failed row — row vanishes, the rows
      below shift up, but the row that was at viewport top should
      stay there.

### 7. Local echo → ACK identity flip

- [ ] Send a message while sitting near the bottom — typical
      stick-to-bottom path: pending row appears, ACK arrives, row
      stays at the bottom. Watch for any visible jump.
- [ ] Send a message, then quickly scroll up to read history while
      the ACK is in flight. When the ACK lands, the position you
      scrolled to must NOT shift.

### 8. Channel switch + return

- [ ] Open conversation A, scroll to mid-history, switch to B.
- [ ] Switch back to A — should restore the same mid-history
      position (R5.3.5 saved-anchor restore). NOT bottom.
- [ ] If A has new inbound messages while you were on B, the
      restore should still land at the saved anchor, not be yanked
      to the new bottom.

### 9. Mobile single-pane layout

- [ ] Resize the window narrow enough to trigger the single-pane
      mobile layout (or use device emulation).
- [ ] Swipe between conversation list and conversation panel.
      Position-restore behavior should match scenario 8.

### 10. Reaction churn

- [ ] Add a reaction to a row in viewport. The row's height shifts
      by one chip's worth.
- [ ] Remove the reaction. Same delta in reverse.
- [ ] Add and remove rapidly (5+ times in quick succession). Watch
      for: position jitter, scroll snapping to the bottom, the
      virtualizer entering a re-measure loop.

## What to log if a regression appears

Capture at the moment of regression:

1. The scenario number (1–10) and the specific action that
   triggered it.
2. Approximate scroll position (top / mid / bottom) before the
   regression.
3. Browser + OS.
4. Console output filtered to `[virtual]` — the implementation
   already emits dev-only warnings on:
   - prepend anchor restore failure (row not found)
   - bridge unable to resolve a vanished anchor key
   - bridged anchor restore failure
5. If reproducible, the rough sequence of events leading up to it.

The goal is to ground the regression in a specific path, not in
"it felt off" — so we can either land a targeted fix or feed a new
spec into `tests/smoke/`.

## Advancing to Phase 2

Default-on requires:

- 7 consecutive days of dogfood with zero regressions logged from
  the checklist.
- Both gates green: `pnpm test:e2e` AND `pnpm test:e2e:virtual`.
- No `[virtual]` console warnings emitted during normal use of any
  scenario above.

When advancing, the change is small:

```
// src/features/chat/use-virtual-timeline-enabled.ts
export function isVirtualTimelineEnabled(): boolean {
  // Phase 2: default ON. Pass `VITE_PRIVCHAT_VIRTUAL_TIMELINE=0`
  // explicitly to fall back to PlainMessageList.
  return import.meta.env.VITE_PRIVCHAT_VIRTUAL_TIMELINE !== '0';
}
```

Plain path stays through Phase 2. Phase 3 (deletion) is a separate
decision after additional real-world hardening.

## Out of scope

Things explicitly NOT being added during dogfood:

- Reply jump for paged-out targets (would extend paging-by-id;
  frozen in `project_reply_local_only`)
- Unread marker virtual row
- Message search
- Multi-account (R7 — separate design note)

If a checklist regression seems to require any of the above to fix,
that's a sign the regression is actually a different round of work,
not an R5 patch.
