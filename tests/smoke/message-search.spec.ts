// Smoke: global message-history search → jump-to-message.
//
// MESSAGE_HISTORY spec §4/§5/§7 UI acceptance on the web client:
//   1. the conversation-list header exposes a search entry;
//   2. typing ≥2 chars (debounced 400ms) surfaces snippet hits with the
//      matched fragment tinted;
//   3. picking a hit opens the channel anchored at the matched message —
//      the row scrolls into view and receives the highlight flash class
//      (same deterministic signal reply-jump asserts on).
//
// The mock adapter mirrors the server contract: substring hits over seeded
// messages + a jumpToMessageContext window with the anchor.

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

test('search finds a message and jumps to it anchored + highlighted', async ({
  page,
}) => {
  await gotoAppFresh(page);

  // Seed: default direct channel 1001 with a needle message buried
  // between two decoys.
  await page.evaluate(() => {
    (window as unknown as {
      __privchatTest: { seed(input: unknown): void };
    }).__privchatTest.seed({
      messages: {
        '1001': [
          {
            channel_id: '1001',
            channel_type: 1,
            server_message_id: '9001',
            from_uid: '101',
            message_type: '0',
            content: 'decoy first message',
            payload: new Uint8Array(),
            timestamp: 1_700_000_000_000,
            pts: '1',
            status: 'received',
          },
          {
            channel_id: '1001',
            channel_type: 1,
            server_message_id: '9002',
            from_uid: '101',
            message_type: '0',
            content: '红包口令 福寿万家 请查收',
            payload: new Uint8Array(),
            timestamp: 1_700_000_001_000,
            pts: '2',
            status: 'received',
          },
          {
            channel_id: '1001',
            channel_type: 1,
            server_message_id: '9003',
            from_uid: 'self',
            message_type: '0',
            content: 'decoy last message',
            payload: new Uint8Array(),
            timestamp: 1_700_000_002_000,
            pts: '3',
            status: 'sent',
          },
        ],
      },
    });
  });

  // 1) open the search dialog from the conversation-list header
  await page.getByRole('button', { name: /搜索聊天记录|Search messages/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // 2) type the query; hit appears after the 400ms debounce with the
  //    matched fragment tinted (text-primary span)
  await dialog.getByRole('textbox').fill('福寿万家');
  const hitRow = dialog.getByRole('button').filter({ hasText: '福寿万家' });
  await expect(hitRow).toBeVisible({ timeout: 5_000 });
  await expect(dialog.locator('span.text-primary', { hasText: '福寿万家' })).toBeVisible();

  // 3) pick the hit → dialog closes, channel opens, anchored row flashes
  await hitRow.click();
  await expect(dialog).not.toBeVisible();

  const anchored = page.locator('[data-message-id="9002"]');
  await expect(anchored).toBeVisible({ timeout: 5_000 });
  await expect(anchored).toHaveClass(/bg-primary\/15/, { timeout: 5_000 });
});
