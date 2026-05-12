// Smoke #5: reply quote click jumps to the original message.
//
// Seeds a 2-message thread where msg #2 quotes msg #1 (via the JSON
// envelope's `reply_to_message_id` field — same wire shape as a real
// reply send), then clicks the quote and verifies the original row's
// DOM anchor receives the highlight class.
//
// We don't assert scroll position numerically — the timeline is
// short enough that the rows are already in view; the highlight
// class is the deterministic signal.

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

test('clicking a reply quote scrolls + flashes the original row', async ({
  page,
}) => {
  await gotoAppFresh(page);

  // Replace the default direct channel's messages with a 2-row reply
  // chain. The reply (#2) carries `reply_to_message_id` in its JSON
  // envelope payload — same shape the SDK builds when a real send
  // includes a reply.
  await page.evaluate(() => {
    const replyEnvelope = JSON.stringify({
      content: 'second',
      mentioned_user_ids: [],
      reply_to_message_id: 'sm-original',
    });
    const payload = new TextEncoder().encode(replyEnvelope);
    (window as unknown as {
      __privchatTest: { seed(input: unknown): void };
    }).__privchatTest.seed({
      messages: {
        '1001': [
          {
            channel_id: '1001',
            channel_type: 1,
            server_message_id: 'sm-original',
            from_uid: '101',
            message_type: '0',
            content: 'first message — reply target',
            payload: new Uint8Array(),
            timestamp: 1_700_000_000_000,
            pts: '1',
            status: 'received',
          },
          {
            channel_id: '1001',
            channel_type: 1,
            server_message_id: 'sm-reply',
            from_uid: 'self',
            message_type: '0',
            content: 'second',
            payload,
            timestamp: 1_700_000_001_000,
            pts: '2',
            status: 'sent',
          },
        ],
      },
    });
  });

  // Open the direct channel.
  await page.getByText('hello there').click();

  // The reply bubble's quote header shows the original content.
  // Click it.
  const quote = page.locator('button', {
    hasText: 'first message — reply target',
  });
  await expect(quote).toBeVisible();
  await quote.click();

  // The jumpToMessage() helper adds `bg-primary/15` to the target row
  // for 1.5s. Tailwind compiles this to a class containing
  // `bg-primary/15` — the literal string is what Playwright sees.
  const target = page.locator('[data-message-id="sm-original"]');
  await expect(target).toHaveClass(/bg-primary\/15/);
});
