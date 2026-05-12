// R5.3.3 — virtual-only smoke: a local-echo row whose key flips
// to a server-acked key in place keeps its screen position. Both
// the row's own visual position AND any in-flight anchor that
// pointed at the local key get bridged to the new key so
// downstream restores remain valid.
//
// Run via:    pnpm test:e2e:virtual
//
// Algorithm:
//   1. Seed 50 simple text messages PLUS a local-echo row inserted
//      between sm-msg-25 and sm-msg-26 (i.e. mid-list, not at the
//      bottom — the realistic "user is reading history while their
//      pending message awaits ACK" position).
//   2. Open the channel — the virtual list parks at the bottom.
//   3. Programmatically scroll so the local echo lands at the top
//      of the viewport: this is the configuration where the
//      anchor primitive captures the local echo as its `recordKey`.
//   4. Capture the local-echo wrapper's `getBoundingClientRect()
//      .top` (the wrapper carries `data-record-key="local:..."`).
//   5. Trigger the ACK via the harness — the same row gains a
//      server_message_id while keeping local_message_id, the React
//      VM re-projects the row's record_key, and the bridge effect
//      rewrites the captured anchor.
//   6. Locate the same row under its NEW key (the wrapper now
//      carries `data-record-key="<server_message_id>"`).
//   7. Assert |after - before| < 16px so the row is visually
//      anchored across the key flip.
//
// We deliberately don't change the row's content during ACK —
// the dynamic-height path is R5.3.4's territory and orthogonal to
// the bridge.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const CHANNEL_ID = '1001';
const LOCAL_MESSAGE_ID = 'local-echo-r533';
const LOCAL_RECORD_KEY = `local:${LOCAL_MESSAGE_ID}`;
const SERVER_MESSAGE_ID = 'sm-acked-r533';
const POSITION_TOLERANCE_PX = 16;

async function topOf(target: Locator): Promise<number> {
  return target.evaluate((el) => el.getBoundingClientRect().top);
}

async function seedConversationWithLocalEcho(page: Page): Promise<void> {
  await page.evaluate(
    ({ channelId, localId }) => {
      const records: unknown[] = [];
      for (let i = 1; i <= 50; i++) {
        if (i === 26) {
          // Insert the local echo just before sm-msg-26 (at index 25).
          // That puts it well above the bottom of the list, so we can
          // realistically scroll into a reading-history position
          // where the local echo is at viewport top.
          records.push({
            channel_id: channelId,
            channel_type: 1,
            local_message_id: localId,
            from_uid: 'self',
            message_type: '0',
            content: 'pending text',
            payload: new Uint8Array(),
            timestamp: 1_700_000_025_500,
            status: 'pending',
          });
        }
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
    },
    { channelId: CHANNEL_ID, localId: LOCAL_MESSAGE_ID },
  );
}

test.describe('virtual ack bridge (R5.3.3)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
    await seedConversationWithLocalEcho(page);
    await page.getByText('hello there').first().click();

    const virtualPanel = page.locator('[data-virtual-timeline="1"]');
    test.skip(
      (await virtualPanel.count()) === 0,
      'virtual-only spec — set VITE_PRIVCHAT_VIRTUAL_TIMELINE=1',
    );
  });

  test('preserves visible row when local echo is replaced by remote message', async ({
    page,
  }) => {
    // Wait for auto-scroll-to-bottom so we know the virtualizer
    // has settled before we issue the manual scroll.
    await expect(
      page.locator('[data-message-id="sm-msg-50"]'),
    ).toBeVisible();

    // Scroll so the local echo is in the viewport, mid-screen.
    // 51 rows × ~estimated 72px ≈ 3672px total; with the local
    // echo at index 25, its virtual offset is ~25 * 72 = 1800px.
    // Scrolling to 1700 puts it ~100px below the chrome — visible
    // at viewport top. A scroll handler tick captures the anchor.
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-virtual-timeline="1"]',
      );
      if (el !== null) el.scrollTop = 1700;
    });

    const localEcho = page.locator(
      `[data-record-key="${LOCAL_RECORD_KEY}"]`,
    );
    await expect(localEcho).toBeVisible();

    // Settle so the on-scroll captureAnchor has run and the
    // virtualizer has settled around its current window.
    await page.waitForTimeout(120);
    const before = await topOf(localEcho);

    // Trigger the ACK: the row gains server_message_id but keeps
    // local_message_id so resolveAnchorRecordKey can bridge.
    await page.evaluate(
      ({ channelId, localId, serverId }) => {
        (window as unknown as {
          __privchatTest: {
            ackLocalMessage(
              channelId: string,
              localId: string,
              remote: Record<string, unknown>,
            ): boolean;
          };
        }).__privchatTest.ackLocalMessage(channelId, localId, {
          server_message_id: serverId,
          pts: '60',
          status: 'sent',
        });
      },
      {
        channelId: CHANNEL_ID,
        localId: LOCAL_MESSAGE_ID,
        serverId: SERVER_MESSAGE_ID,
      },
    );

    // The wrapper's data-record-key now reflects the new key
    // (record_key flipped from `local:...` to the server_message_id).
    const remote = page.locator(`[data-record-key="${SERVER_MESSAGE_ID}"]`);
    await expect(remote).toBeAttached();
    await expect(localEcho).toHaveCount(0);

    await page.waitForTimeout(120);
    const after = await topOf(remote);

    expect(Math.abs(after - before)).toBeLessThan(POSITION_TOLERANCE_PX);
  });
});
