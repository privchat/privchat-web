import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const CHANNEL_ID = '1001';
const LAST_MESSAGE_ID = 'tail-message-40';
const LONG_BODY = Array.from(
  { length: 35 },
  (_, index) => `decoded image replacement line ${index + 1}`,
).join('\n');

test('plain timeline stays at the tail when the last row grows asynchronously', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await gotoAppFresh(page);
  await page.evaluate((channelId) => {
    const records = Array.from({ length: 40 }, (_, index) => ({
      channel_id: channelId,
      channel_type: 1,
      server_message_id: `tail-message-${index + 1}`,
      from_uid: index % 2 === 0 ? '101' : 'self',
      message_type: '0',
      content: `message ${index + 1}`,
      payload: new Uint8Array(),
      timestamp: 1_700_000_000_000 + index * 1000,
      pts: String(index + 1),
      status: index % 2 === 0 ? 'received' : 'sent',
    }));
    (window as unknown as {
      __privchatTest: { seed(input: unknown): void };
    }).__privchatTest.seed({ messages: { [channelId]: records } });
  }, CHANNEL_ID);

  await page.getByText('hello there').first().click();
  const timeline = page.locator('[data-plain-timeline="1"]');
  await expect(timeline).toBeVisible();
  await expect(page.locator(`[data-message-id="${LAST_MESSAGE_ID}"]`)).toBeVisible();

  await page.evaluate(
    ({ channelId, messageId, content }) => {
      (window as unknown as {
        __privchatTest: {
          patchMessage(
            channel: string,
            recordKey: string,
            patch: Record<string, unknown>,
          ): boolean;
        };
      }).__privchatTest.patchMessage(channelId, messageId, { content });
    },
    { channelId: CHANNEL_ID, messageId: LAST_MESSAGE_ID, content: LONG_BODY },
  );

  await expect
    .poll(() =>
      timeline.evaluate(
        (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
      ),
    )
    .toBeLessThan(32);
});
