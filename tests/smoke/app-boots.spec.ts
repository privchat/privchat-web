// Smoke #1: App boots with the test harness mounted.
//
// Bare-minimum proof that the bundle, harness wiring, providers, and
// chrome layout all come up. If this fails we don't bother running
// the rest of the suite — the runner halts at the first spec.

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

test('app loads, sidebar tabs and conversation panel chrome render', async ({
  page,
}) => {
  await gotoAppFresh(page);

  // Sidebar tabs (Chats / Contacts / Groups) — all three present at
  // boot regardless of which tab is active.
  await expect(page.getByRole('button', { name: /^Chats$|^会话$/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Contacts$|^联系人$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Groups$|^群聊$/ }),
  ).toBeVisible();

  // Top-bar carries our identity. The harness seeds selfUid='self'
  // with display name "Me". Look for the @PrivChat suffix as the
  // anchor — it's stable regardless of nickname tokenisation.
  await expect(page.getByText(/@PrivChat/i)).toBeVisible();
});
