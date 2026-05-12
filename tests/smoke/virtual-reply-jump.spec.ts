// R5.4 — virtual-only smoke: reply-jump three-state completion.
//
// Run via:    pnpm test:e2e:virtual
//
// Two specs:
//
//   1. "scrolls to loaded reply target that is outside mounted
//      window" — the core R5.4 case. We seed a reply chain where
//      the original (sm-msg-10) is far from the bottom, the
//      virtualizer initially mounts only the bottom region, and
//      clicking the quote on the latest row should pull the
//      virtualizer to the original AND flash it once it mounts.
//
//   2. "shows fallback when reply target is not loaded" — the
//      not-loaded case. The reply points at a server_message_id
//      that doesn't exist in the loaded array. Click should
//      surface the floating "out of window" toast (sourced from
//      the existing `message_actions.reply_out_of_window` key)
//      and NOT scroll the timeline.
//
// The original mounted-case is exercised by `reply-jump.spec.ts`
// in both plain and virtual mode (it auto-runs against whichever
// path is active), so we don't duplicate that here.

import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const CHANNEL_ID = '1001';

const replyEnvelope = (replyToServerMessageId: string, content: string) => {
  const env = {
    content,
    mentioned_user_ids: [],
    reply_to_message_id: replyToServerMessageId,
  };
  return Array.from(new TextEncoder().encode(JSON.stringify(env)));
};

async function seedThreadWithDistantReply(page: Page): Promise<void> {
  // 80 rows, where the LAST row is a reply to sm-msg-10 (deep
  // history). Initial render parks at the bottom, so sm-msg-10 is
  // well outside the rendered virtual window — exactly the
  // loaded-but-not-mounted scenario.
  await page.evaluate(
    ({ channelId, payload }) => {
      const records: unknown[] = [];
      for (let i = 1; i <= 80; i++) {
        if (i < 80) {
          records.push({
            channel_id: channelId,
            channel_type: 1,
            server_message_id: `sm-msg-${i}`,
            from_uid: i % 2 === 0 ? '101' : 'self',
            message_type: '0',
            content: i === 10 ? 'reply target row' : `message ${i}`,
            payload: new Uint8Array(),
            timestamp: 1_700_000_000_000 + i * 1000,
            pts: String(i),
            status: i % 2 === 0 ? 'received' : 'sent',
          });
        } else {
          records.push({
            channel_id: channelId,
            channel_type: 1,
            server_message_id: 'sm-msg-80',
            from_uid: 'self',
            message_type: '0',
            content: 'latest with reply',
            payload: new Uint8Array(payload),
            timestamp: 1_700_000_000_000 + 80 * 1000,
            pts: '80',
            status: 'sent',
          });
        }
      }
      (window as unknown as {
        __privchatTest: { seed(input: unknown): void };
      }).__privchatTest.seed({ messages: { [channelId]: records } });
    },
    {
      channelId: CHANNEL_ID,
      payload: replyEnvelope('sm-msg-10', 'latest with reply'),
    },
  );
}

async function seedThreadWithMissingReply(page: Page): Promise<void> {
  // Two rows where the second one's reply_to points at a
  // server_message_id that does NOT exist in the loaded array.
  await page.evaluate(
    ({ channelId, payload }) => {
      (window as unknown as {
        __privchatTest: { seed(input: unknown): void };
      }).__privchatTest.seed({
        messages: {
          [channelId]: [
            {
              channel_id: channelId,
              channel_type: 1,
              server_message_id: 'sm-only',
              from_uid: '101',
              message_type: '0',
              content: 'first message',
              payload: new Uint8Array(),
              timestamp: 1_700_000_000_000,
              pts: '1',
              status: 'received',
            },
            {
              channel_id: channelId,
              channel_type: 1,
              server_message_id: 'sm-reply-missing',
              from_uid: 'self',
              message_type: '0',
              content: 'reply pointing at nothing',
              payload: new Uint8Array(payload),
              timestamp: 1_700_000_001_000,
              pts: '2',
              status: 'sent',
            },
          ],
        },
      });
    },
    {
      channelId: CHANNEL_ID,
      payload: replyEnvelope('sm-message-that-does-not-exist', 'reply pointing at nothing'),
    },
  );
}

test.describe('virtual reply jump (R5.4)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('scrolls to loaded reply target that is outside mounted window', async ({
    page,
  }) => {
    await seedThreadWithDistantReply(page);
    await page.getByText('hello there').first().click();

    const virtualPanel = page.locator('[data-virtual-timeline="1"]');
    test.skip(
      (await virtualPanel.count()) === 0,
      'virtual-only spec — set VITE_PRIVCHAT_VIRTUAL_TIMELINE=1',
    );

    // Confirm initial render: latest row is mounted, deep target is
    // not. The wrapper for the deep target carries
    // data-record-key=sm-msg-10 only when mounted, so absence is
    // the deterministic signal that the virtualizer hasn't rendered
    // it yet.
    await expect(page.locator('[data-message-id="sm-msg-80"]')).toBeVisible();
    await expect(
      page.locator('[data-record-key="sm-msg-10"]'),
    ).toHaveCount(0);

    // The reply quote on the latest row carries the original's
    // content text — clicking it triggers `handleReplyJump`'s
    // loaded-but-not-mounted branch.
    const quote = page.locator('button', { hasText: 'reply target row' });
    await expect(quote).toBeVisible();
    await quote.click();

    // The virtualizer scrolls to index 9, the row mounts, the
    // post-mount layout effect applies the flash class. Both
    // assertions together confirm the case-2 path end-to-end.
    const target = page.locator('[data-message-id="sm-msg-10"]');
    await expect(target).toBeVisible();
    await expect(target).toHaveClass(/bg-primary\/15/);
  });

  test('shows fallback when reply target is not loaded', async ({ page }) => {
    await seedThreadWithMissingReply(page);
    await page.getByText('hello there').first().click();

    const virtualPanel = page.locator('[data-virtual-timeline="1"]');
    test.skip(
      (await virtualPanel.count()) === 0,
      'virtual-only spec — set VITE_PRIVCHAT_VIRTUAL_TIMELINE=1',
    );

    // The original is missing, so ReplyQuote renders the
    // `reply_unavailable` placeholder. That's the click target.
    const quote = page.locator('button', {
      hasText: '[Original message unavailable]',
    });
    await expect(quote).toBeVisible();

    // Snapshot scrollTop before the click so we can assert it does
    // NOT change (case 3 must not scroll the timeline).
    const beforeScrollTop = await virtualPanel.first().evaluate(
      (el) => (el as HTMLElement).scrollTop,
    );

    await quote.click();

    // The toast is appended directly to the scroll container. Its
    // text comes from the existing `reply_out_of_window` i18n key,
    // surrounded by middle-dots in the helper.
    const toast = virtualPanel
      .first()
      .locator('text=Original message not loaded in this window');
    await expect(toast).toBeVisible();

    // No scroll motion in case 3.
    const afterScrollTop = await virtualPanel.first().evaluate(
      (el) => (el as HTMLElement).scrollTop,
    );
    expect(afterScrollTop).toBe(beforeScrollTop);
  });
});
