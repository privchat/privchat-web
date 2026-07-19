// Smoke #2 + #3: conversation list renders + send-text happy path.
//
// Both share the same seed, so they live in one spec file to avoid
// re-booting the harness twice for two tightly related assertions.

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

test.describe('conversation list + send', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('renders pre-seeded direct + group rows and lets the user pick one', async ({
    page,
  }) => {
    // Default seed includes a direct chat (peer "Alice" → uid 101)
    // and a group "Engineering". Both should appear in the sidebar
    // after channel-list bootstrap fires. The text matches multiple
    // DOM nodes (chats tab row + hidden groups tab row) so we pick
    // the first visible one.
    const engRow = page.getByText('Engineering').first();
    await expect(engRow).toBeVisible();

    // Click the group row → conversation panel opens. Composer is
    // the cleanest "panel open" signal.
    await engRow.click();
    await expect(
      page.getByPlaceholder(/Type a message|输入消息/),
    ).toBeVisible();
  });

  test('typing + Enter sends a text message that lands in the timeline', async ({
    page,
  }) => {
    await page.getByText('Engineering').first().click();

    const composer = page.getByPlaceholder(/Type a message|输入消息/);
    await composer.fill('hello world');
    await composer.press('Enter');

    // The mock adapter persists the sent message synchronously and
    // emits via observers; the row should be visible immediately.
    await expect(
      page.locator('[data-message-id]').filter({ hasText: 'hello world' }),
    ).toBeVisible();
    // After send, the composer empties (the panel calls notifyTyping('')
    // and clears its draft state).
    await expect(composer).toHaveValue('');
  });

  test('renders a localized placeholder for an image-only preview', async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as unknown as {
        __privchatTest: { seed(input: unknown): void };
      }).__privchatTest.seed({
        channels: [
          {
            channel_id: '1001',
            channel_type: 1,
            title: '101',
            latest_pts: '6',
            read_pts: '6',
            unread_count: 0,
            last_message_preview: '',
            last_message_type: 'image',
            updated_at: Date.now(),
            sync_version: 2,
          },
        ],
      });
    });

    await expect(page.getByText(/^\[(图片|Image)\]$/)).toBeVisible();
  });
});
