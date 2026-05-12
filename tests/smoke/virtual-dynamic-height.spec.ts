// R5.3.4 — virtual-only smoke: a row growing taller while the user
// is mid-list does not move the user's reading position.
//
// Run via:    pnpm test:e2e:virtual
//
// In plain mode this spec auto-skips because it asserts behaviour
// only the virtual list has wired up.
//
// Algorithm:
//   1. Seed 50 simple text messages.
//   2. Open the channel — the virtual list parks at the bottom.
//   3. Programmatically scroll the user mid-list so they're reading
//      history (NOT near the bottom).
//   4. Pick an anchor row that's visible at viewport top
//      (sm-msg-21 with the seeded fixture and our scroll offset)
//      and capture its `getBoundingClientRect().top`.
//   5. Patch sm-msg-22 (a row also mounted, just below the anchor)
//      to carry a much longer body — the bubble's measured height
//      grows by several hundred pixels.
//   6. Wait for the new content to commit + the height-change rAF
//      to apply its anchor restore.
//   7. Re-read the anchor row's top.
//   8. Assert the screen position drifted by less than 16px. The
//      tolerance soaks up rendering jitter; without R5.3.4's
//      anchor-restore the visible row would drift by the full
//      height delta (~hundreds of px).
//
// We deliberately do NOT exercise the "near-bottom" branch of the
// height-change handler in this spec — that path is well-served by
// the existing stick-to-bottom invariants and a separate smoke can
// land later. R5.3.4's first version just proves the anchor branch.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const CHANNEL_ID = '1001';
// Anchor row — the one whose screen position we want to preserve.
// Picked AFTER the spec scrolls to its mid-list position so we can
// trust that this row is visible at viewport top.
const ANCHOR_MESSAGE_ID = 'sm-msg-21';
// Growing row — sits just below the anchor, also mounted in the
// virtualizer's window, and resizes via `patchMessage`.
const GROWING_MESSAGE_ID = 'sm-msg-22';
const POSITION_TOLERANCE_PX = 16;

const LONG_BODY = Array.from({ length: 30 }, (_, i) => `expansion line ${i + 1}`).join('\n');

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

test.describe('virtual dynamic height (R5.3.4)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
    await seedFiftyMessages(page);
    await page.getByText('hello there').first().click();

    const virtualPanel = page.locator('[data-virtual-timeline="1"]');
    test.skip(
      (await virtualPanel.count()) === 0,
      'virtual-only spec — set VITE_PRIVCHAT_VIRTUAL_TIMELINE=1',
    );
  });

  test('preserves visible row when a nearby row grows in height', async ({
    page,
  }) => {
    // Wait for the auto-scroll-to-bottom so we know the virtualizer
    // has settled before we issue our manual scroll.
    await expect(
      page.locator('[data-message-id="sm-msg-50"]'),
    ).toBeVisible();

    // Scroll the user mid-list. With 50 rows of ~estimated 72px the
    // virtual area is ~3600px tall; 1500px puts the user well away
    // from the bottom and squarely in "reading history" territory.
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-virtual-timeline="1"]',
      );
      if (el !== null) el.scrollTop = 1500;
    });

    const anchor = page.locator(`[data-message-id="${ANCHOR_MESSAGE_ID}"]`);
    const grower = page.locator(`[data-message-id="${GROWING_MESSAGE_ID}"]`);
    await expect(anchor).toBeVisible();
    await expect(grower).toBeVisible();

    // Settle: scroll handler runs `captureAnchor` → `currentAnchorRef`,
    // virtualizer remeasures, ResizeObserver populates rowHeightsRef.
    // Without this, our measurement of `before` could race the
    // virtualizer's own first-mount measurement pass.
    await page.waitForTimeout(120);
    const before = await topOf(anchor);

    // Trigger the dynamic-height path: patch sm-msg-22 to a much
    // longer body. The MessageRow re-renders, ResizeObserver fires,
    // our `measureElement` override compares previous vs new height,
    // schedules the rAF, and restores the captured anchor.
    await page.evaluate(
      ({ channelId, recordKey, longBody }) => {
        (window as unknown as {
          __privchatTest: {
            patchMessage(
              channelId: string,
              recordKey: string,
              patch: Record<string, unknown>,
            ): boolean;
          };
        }).__privchatTest.patchMessage(channelId, recordKey, {
          content: longBody,
        });
      },
      {
        channelId: CHANNEL_ID,
        recordKey: GROWING_MESSAGE_ID,
        longBody: LONG_BODY,
      },
    );

    // Wait for the row to actually grow. Reading its bounding box
    // height is the cleanest deterministic signal that the
    // ResizeObserver-driven measurement has flowed through.
    await expect
      .poll(async () => {
        return grower.evaluate((el) => el.getBoundingClientRect().height);
      })
      .toBeGreaterThan(120);

    // Allow rAF + the virtualizer's own re-render after measurement
    // to settle. 120ms covers ≥ 7 frames at 60Hz, which is plenty.
    await page.waitForTimeout(120);
    const after = await topOf(anchor);

    expect(Math.abs(after - before)).toBeLessThan(POSITION_TOLERANCE_PX);
  });
});
