// R5.3.2 — virtual-only smoke: history prepend keeps the user's
// reading position stable.
//
// Run via:    pnpm test:e2e:virtual
//
// In plain mode this spec auto-skips because it asserts behaviour
// only the virtual list has wired up. The plain timeline has its
// own anchor-preservation story and isn't under test here.
//
// Algorithm:
//   1. Seed 50 simple text messages so the timeline is tall enough
//      to virtualize.
//   2. Open the channel — the virtual list parks at the bottom.
//   3. Programmatically scroll to the very top so the "Load older"
//      button is visible (clicking it later does not auto-scroll
//      and disturb our captured anchor).
//   4. Wait for the first message row (sm-msg-1) to mount and
//      capture its `getBoundingClientRect().top`.
//   5. Queue a 20-message prepend page on the harness.
//   6. Click "Load older" — flows through `useConversation.loadOlder`
//      → `adapter.scrollHistory` (mock consumes the queued page +
//      notifies observers, mirroring the real server roundtrip).
//   7. Wait for the prepended messages to land.
//   8. Re-read sm-msg-1's top.
//   9. Assert the screen position drifted by less than 16px.
//
// The 16px tolerance soaks up the (very small) gap between the
// virtualizer's `estimateSize` and a freshly-mounted row's
// measured size — anything bigger means the anchor restore
// regressed.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const CHANNEL_ID = '1001';
// Use the FIRST (topmost) message row as the target. After scrolling
// to scrollTop=0 the user is staring at sm-msg-1; this is the row
// the anchor primitive locks onto (topmost visible inside the
// virtual area), so it's the strictest restore-correctness probe.
const TARGET_MESSAGE_ID = 'sm-msg-1';
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

async function queueOldPage(page: Page, count: number): Promise<void> {
  await page.evaluate(
    ({ channelId, n }) => {
      const records = [];
      for (let i = 1; i <= n; i++) {
        records.push({
          channel_id: channelId,
          channel_type: 1,
          server_message_id: `sm-old-${i}`,
          from_uid: '101',
          message_type: '0',
          content: `old ${i}`,
          payload: new Uint8Array(),
          // older than the seeded set
          timestamp: 1_699_999_000_000 + i * 1000,
          pts: String(-1000 + i),
          status: 'received',
        });
      }
      (window as unknown as {
        __privchatTest: {
          queuePrependPage(channelId: string, records: unknown[]): void;
        };
      }).__privchatTest.queuePrependPage(channelId, records);
    },
    { channelId: CHANNEL_ID, n: count },
  );
}

test.describe('virtual prepend (R5.3.2)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
    await seedFiftyMessages(page);
    await page.getByText('hello there').first().click();

    // Skip when running on the plain path. The virtual list tags
    // its scroll container with `data-virtual-timeline="1"`; if
    // that's not in the DOM, we're in the un-virtualized path.
    const virtualPanel = page.locator('[data-virtual-timeline="1"]');
    test.skip(
      (await virtualPanel.count()) === 0,
      'virtual-only spec — set VITE_PRIVCHAT_VIRTUAL_TIMELINE=1',
    );
  });

  test('preserves visible row position when prepending older messages', async ({
    page,
  }) => {
    // Wait for the auto-scroll-to-bottom to have rendered the last
    // row. Without this, the immediate scroll-to-top might race the
    // initial position-to-bottom effect.
    await expect(
      page.locator('[data-message-id="sm-msg-50"]'),
    ).toBeVisible();

    // Scroll all the way up so both the "Load older" button AND
    // sm-msg-1 are visible. Clicking the button now won't trigger
    // Playwright's auto-scroll-into-view (which would otherwise
    // perturb the captured anchor mid-test).
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-virtual-timeline="1"]',
      );
      if (el !== null) el.scrollTop = 0;
    });

    const target = page.locator(`[data-message-id="${TARGET_MESSAGE_ID}"]`);
    await expect(target).toBeVisible();

    // Tiny settle — the scroll handler kicks captureAnchor and the
    // virtualizer remeasures; we want the next read to be against
    // the post-settle frame.
    await page.waitForTimeout(80);
    const before = await topOf(target);

    // Queue 20 older messages → click "Load older" → observed
    // via the load-older button onclick → handleLoadOlder captures
    // anchor → onLoadOlder() → adapter.scrollHistory consumes the
    // queue → notifyConv → React re-renders → layout effect
    // restores anchor.
    await queueOldPage(page, 20);
    const loadOlderBtn = page.getByRole('button', { name: /Load older/i });
    await expect(loadOlderBtn).toBeVisible();
    await loadOlderBtn.click();

    // Wait for the prepend to land. We pick `sm-old-20` (the
    // newest queued row, immediately preceding sm-msg-1 in the new
    // array) as the signal — it lands inside the virtualizer's
    // overscan window above the restored viewport, whereas the
    // earliest queued rows (sm-old-1, etc.) stay unmounted because
    // they're far above and out of overscan range.
    await expect(page.locator('[data-message-id="sm-old-20"]')).toBeAttached();

    // Two rAFs (≈32ms at 60Hz) plus a small buffer for the
    // restoreAnchor's double-rAF chain to settle.
    await page.waitForTimeout(80);
    const after = await topOf(target);

    expect(Math.abs(after - before)).toBeLessThan(POSITION_TOLERANCE_PX);
  });
});
