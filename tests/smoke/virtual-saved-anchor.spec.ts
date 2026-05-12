// R5.3.5 — virtual-only smoke: cross-session saved-anchor restore.
//
// Run via:    pnpm test:e2e:virtual
//
// In plain mode this spec auto-skips (the plain path has its own
// scroll-anchor restore covered elsewhere).
//
// Algorithm:
//   1. Seed 50 simple text messages on the direct channel so the
//      timeline is tall enough to virtualize.
//   2. Open the direct channel (default lands at the bottom).
//   3. Programmatically scroll so a known mid-list row (sm-msg-25)
//      is visible near the top of the viewport. Settle, then read
//      its `getBoundingClientRect().top` — this is the position the
//      restore must recreate.
//   4. Switch to the group channel ("standup at 10"). The
//      VirtualMessageList stays mounted but `channelId` flips, so
//      the cleanup of the [channelId]-keyed save effect runs with
//      the OLD channelId and persists `currentAnchorRef.current` to
//      the in-memory storage.
//   5. Switch back to the direct channel ("hello there"). The first-
//      mount-per-channel positioning effect calls
//      `loadVirtualScrollAnchor(channelId)`, finds the saved row,
//      and restores via `restoreAnchor`.
//   6. Wait for sm-msg-25 to be visible again, then re-read its top.
//   7. Assert the screen position drifted by less than 16px.
//
// The 16px tolerance is the same one used by R5.3.2 (virtual prepend)
// and R5.3.4 (dynamic-height): it absorbs the small delta between
// `estimateSize` and a freshly-mounted row's measured size, plus the
// double-rAF chain inside `restoreAnchor`.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const CHANNEL_ID = '1001';
// sm-msg-25 sits roughly halfway through a 50-row seed, far enough
// from both ends that small overscan / measurement drift can't
// silently push it back into view via either edge.
const TARGET_MESSAGE_ID = 'sm-msg-25';
const POSITION_TOLERANCE_PX = 16;

async function topOf(target: Locator): Promise<number> {
  return target.evaluate((el) => el.getBoundingClientRect().top);
}

async function seedFiftyMessages(page: Page): Promise<void> {
  await page.evaluate((channelId) => {
    const records = [];
    for (let i = 1; i <= 50; i++) {
      records.push({
        channel_id: channelId,
        channel_type: 1,
        server_message_id: `sm-msg-${i}`,
        from_uid: i % 2 === 0 ? '101' : 'self',
        message_type: '0',
        content: `message ${i}`,
        payload: new Uint8Array(),
        timestamp: 1_700_000_000_000 + i * 1000,
        pts: String(i),
        status: i % 2 === 0 ? 'received' : 'sent',
      });
    }
    (window as unknown as {
      __privchatTest: { seed(input: unknown): void };
    }).__privchatTest.seed({ messages: { [channelId]: records } });
  }, CHANNEL_ID);
}

test.describe('virtual saved anchor (R5.3.5)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
    await seedFiftyMessages(page);
    await page.getByText('hello there').first().click();

    // Skip when running on the plain path.
    const virtualPanel = page.locator('[data-virtual-timeline="1"]');
    test.skip(
      (await virtualPanel.count()) === 0,
      'virtual-only spec — set VITE_PRIVCHAT_VIRTUAL_TIMELINE=1',
    );
  });

  test('restores scroll position after switching away and back', async ({ page }) => {
    // Wait for the auto-scroll-to-bottom to complete so the captured
    // sm-msg-50 row is on screen — confirms the virtual area has
    // measured at least one full window.
    await expect(page.locator('[data-message-id="sm-msg-50"]')).toBeVisible();

    // Bring sm-msg-25 into the rendered window. The virtualizer only
    // mounts rows in the visible+overscan range, and the auto-scroll-
    // to-bottom on first mount has parked sm-msg-50 at the bottom —
    // sm-msg-25 isn't in the DOM yet. Setting scrollTop on the
    // virtual root triggers `useVirtualizer`'s onScroll, which
    // remeasures and mounts the rows for the new range.
    //
    // 50 rows × ~72px estimateSize ≈ 3600px content. scrollTop ≈ 1700
    // puts the sm-msg-25 area near the middle of the viewport, with
    // overscan=8 covering either side so the row is reliably mounted.
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-virtual-timeline="1"]',
      );
      if (el !== null) el.scrollTop = 1700;
    });
    await page.waitForTimeout(80);

    const target = page.locator(`[data-message-id="${TARGET_MESSAGE_ID}"]`);
    await expect(target).toBeAttached();

    // Precise top-of-viewport alignment so the captured anchor's
    // `offsetFromTop` is small and the comparison after restore is
    // strict against the same anchor row.
    await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));

    // Settle: the on-scroll handler captures the new currentAnchorRef
    // and the virtualizer re-measures any newly mounted rows.
    await page.waitForTimeout(80);
    await expect(target).toBeVisible();
    const before = await topOf(target);

    // Switch to the group channel. ConversationPanel keeps the
    // VirtualMessageList mounted across channels — only channelId
    // flips — so the save effect's cleanup runs with channelId='1001'
    // and persists the captured anchor to virtualPositions.
    //
    // `Engineering` shows up in the conversation list AND in the
    // sidebar tabs, so the locator must be `.first()` to avoid
    // strict-mode ambiguity.
    await page.getByText('Engineering').first().click();

    // Confirm the channel actually switched: sm-msg-25 belongs to the
    // direct channel; with channelId='900' the virtual list shouldn't
    // be rendering any sm-msg-* rows. Detached → switch landed.
    await expect(target).toHaveCount(0);

    // Switch back. The first-mount-per-channel effect for
    // channelId='1001' loads the saved anchor and calls
    // restoreAnchor before falling back to scroll-to-bottom.
    await page.getByText('Alice').first().click();

    // Wait for sm-msg-25 to be back in the DOM and visible again.
    // The restoreAnchor path uses scrollToIndex + double-rAF
    // adjustment; React Strict Mode (dev) runs the cleanup→remount
    // cycle which means the restore happens twice in a row, each
    // with its own double-rAF tail. 200ms covers both worst-case
    // and any incidental virtualizer remeasurement.
    await expect(target).toBeVisible();
    await page.waitForTimeout(200);
    const after = await topOf(target);

    expect(Math.abs(after - before)).toBeLessThan(POSITION_TOLERANCE_PX);
  });
});
