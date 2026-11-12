// BLACKLIST_SPEC §4.3 management surface smoke.
//
// Opens the self profile card → blacklist dialog, asserts the seeded list
// renders (name resolved from the local user cache), and that Unblock
// removes the row end-to-end (mock mutates state.blacklist). Also covers
// the empty state. No live server.

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

interface BlacklistHarness {
  seed(input: unknown): void;
}

async function openBlacklist(page: import('@playwright/test').Page) {
  await page.getByTestId('self-profile-trigger').click();
  await page.getByTestId('profile-card-blacklist-self').click();
}

test.describe('blacklist management', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('lists blocked users and unblocks end-to-end', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __privchatTest: BlacklistHarness }).__privchatTest.seed({
        blacklist: [
          {
            user_id: 0,
            blocked_user_id: 101,
            blocked_at: '2026-11-01T00:00:00.000Z',
            reason: 'spam',
          },
        ],
      });
    });

    await openBlacklist(page);

    const row = page.locator('[data-testid="blacklist-row"][data-uid="101"]');
    await expect(row).toBeVisible();
    // Name resolves from the seeded local user cache (Alice = uid 101).
    await expect(row).toContainText('Alice');
    await expect(row).toContainText('spam');

    // Unblock prompts a native confirm() — accept it.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('blacklist-unblock').click();

    await expect(row).toHaveCount(0);
    await expect(page.getByTestId('blacklist-empty')).toBeVisible();
  });

  test('shows the empty state when nobody is blocked', async ({ page }) => {
    await openBlacklist(page);
    await expect(page.getByTestId('blacklist-empty')).toBeVisible();
    await expect(page.getByTestId('blacklist-row')).toHaveCount(0);
  });
});