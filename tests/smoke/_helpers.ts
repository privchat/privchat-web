// Shared bits across smoke specs. Kept tiny on purpose — the harness
// itself does most of the heavy lifting; specs just call `seed()` and
// click buttons.

import type { Page } from '@playwright/test';

/** Wait for the test harness controls to be installed on `window`. */
export async function waitForHarness(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as {
    __privchatTest?: unknown;
  }).__privchatTest));
}

/** Reset the harness back to default state. Call at the start of
 *  each spec for isolation — Playwright workers share the dev server
 *  so leakage between tests is real. */
export async function resetHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __privchatTest: { reset(): void } }).__privchatTest.reset();
  });
}

/** Convenience: navigate + wait + reset. Most specs start this way. */
export async function gotoAppFresh(page: Page): Promise<void> {
  await page.goto('/');
  await waitForHarness(page);
  await resetHarness(page);
}
