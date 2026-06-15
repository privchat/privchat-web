// Smoke: the SDK's terminal `session_expired` signal surfaces a re-login
// dialog, and confirming it dismisses the dialog (production also clears
// the session + routes to login; in test mode the dismissal is the
// observable contract).
//
// Fidelity note: TestApp mirrors App.tsx's session_expired → dialog
// wiring (as it already mirrors App.tsx's account state machine). The
// coordinator logic that DECIDES to fire session_expired (refresh
// single-flight / retry-once / terminal classification) is covered by
// SDK unit tests; this spec covers the UI surface + confirm path.

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

function fireSessionExpired(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    (
      window as unknown as { __privchatTest: { fireSessionExpired(): void } }
    ).__privchatTest.fireSessionExpired();
  });
}

test('session_expired shows the re-login dialog; confirm dismisses it', async ({
  page,
}) => {
  await gotoAppFresh(page);

  const dialog = page.getByTestId('session-expired-dialog');
  await expect(dialog).toBeHidden();

  await fireSessionExpired(page);

  await expect(dialog).toBeVisible();
  await expect(page.getByText(/Session expired|登录已过期/)).toBeVisible();

  await page.getByTestId('session-expired-confirm').click();
  await expect(dialog).toBeHidden();
});

test('dialog is not shown on a normal session (no false positive)', async ({
  page,
}) => {
  await gotoAppFresh(page);
  await expect(page.getByTestId('session-expired-dialog')).toBeHidden();
});
