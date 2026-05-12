// Smoke #4: failed-outbox retry surface (A1).
//
// Seeds one cached message with an outbox row in `failed` state
// (engine retries already exhausted), opens the channel, asserts the
// "Send failed · Retry · Discard" affordance is visible under the
// row, clicks Retry, and verifies the affordance disappears (the
// mock adapter's `retryOutboxEntry` drops the row and notifies
// outbox listeners → the join in `useConversation` clears
// `outbox_status`).

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

test('shows "Send failed · Retry" on a failed outbox row and clears it on retry', async ({
  page,
}) => {
  await gotoAppFresh(page);

  // Open the direct channel (seeded by default at channel_id "1001"
  // with peer 101).
  await page.evaluate(() => {
    (window as unknown as {
      __privchatTest: {
        seedFailedMessage(args: {
          channelId: string;
          channelType?: number;
          content: string;
        }): { local_message_id: string };
      };
    }).__privchatTest.seedFailedMessage({
      channelId: '1001',
      channelType: 1,
      content: 'this never landed',
    });
  });

  // Click the seeded direct row. The default channel preview is
  // "hello there" — that's stable across runs.
  await page.getByText('hello there').click();

  // The failed-message helper is a small footer row with "重试" /
  // "Retry" link.
  const retryLink = page.getByRole('button', { name: /Retry|重试$/ });
  await expect(retryLink).toBeVisible();

  // Also assert the failed badge is showing.
  await expect(
    page.getByText(/Send failed|发送失败/),
  ).toBeVisible();

  await retryLink.click();

  // The harness drops the outbox row on retry; the FailedMessageActions
  // component unmounts (no `outbox_status === 'failed'` join anymore).
  await expect(retryLink).toBeHidden();
});
