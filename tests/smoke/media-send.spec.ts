// Smoke: media upload failures surface as a RETRYABLE TIMELINE BUBBLE,
// not a composer-level error (the regression this feature fixes).
//
// The mock adapter's media send honours `__privchatTest.setMediaSendOutcome`:
// 'fail' (default) rejects → the media-send store marks the optimistic
// bubble failed; 'ok' resolves → the store clears the overlay (the
// real SDK row would replace it in production). We drive an image send
// via the hidden file input and assert the in-timeline affordances.

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

/** A 1x1 PNG; content is irrelevant — the mock never reads the bytes and
 *  the panel's dimension probe falls back to 0x0 on decode failure. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function openDirectChannel(page: import('@playwright/test').Page) {
  // Default seed: direct channel 1001 with preview "hello there".
  await page.getByText('hello there').click();
}

async function attachImage(page: import('@playwright/test').Page) {
  await page
    .locator('input[type="file"][accept*="image"]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG_1x1 });
}

test('upload failure shows a retryable bubble in the timeline (not a composer error)', async ({
  page,
}) => {
  await gotoAppFresh(page);
  await openDirectChannel(page);

  // Default outcome is 'fail' → the send rejects.
  await attachImage(page);

  // The failure is rendered IN the timeline (upload_failed + retry +
  // dismiss), which is the whole point — previously it was only a
  // composer-level "上传失败" chip with no message bubble.
  await expect(page.getByText(/Upload failed|上传失败/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Retry$|^重试$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Remove$|^移除$/ }),
  ).toBeVisible();
});

test('dismiss removes the failed media bubble', async ({ page }) => {
  await gotoAppFresh(page);
  await openDirectChannel(page);
  await attachImage(page);

  const failed = page.getByText(/Upload failed|上传失败/);
  await expect(failed).toBeVisible();

  await page.getByRole('button', { name: /^Remove$|^移除$/ }).click();
  await expect(failed).toBeHidden();
});

test('retry after switching the outcome to ok clears the failed bubble', async ({
  page,
}) => {
  await gotoAppFresh(page);
  await openDirectChannel(page);

  // First attempt fails.
  await attachImage(page);
  const failed = page.getByText(/Upload failed|上传失败/);
  await expect(failed).toBeVisible();

  // Make the next send resolve, then retry — the store clears the
  // overlay entry on a resolved send, so the failed affordance vanishes.
  await page.evaluate(() => {
    (
      window as unknown as {
        __privchatTest: { setMediaSendOutcome(o: 'fail' | 'ok'): void };
      }
    ).__privchatTest.setMediaSendOutcome('ok');
  });
  await page.getByRole('button', { name: /^Retry$|^重试$/ }).click();

  await expect(failed).toBeHidden();
});
