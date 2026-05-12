// Smoke #6: sidebar tabs open the right list + tapping rows opens
// the right conversation type. Covers the Contacts → direct flow
// (calls channelDirectGetOrCreate via the harness mock) and the
// Groups → group flow (uses the channel_id == group_id invariant).

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

test.describe('sidebar tabs', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('Contacts tab lists friends; tapping one opens the direct chat', async ({
    page,
  }) => {
    // Switch to Contacts.
    await page.getByRole('button', { name: /^Contacts$|^联系人$/ }).click();

    // Scope to the contacts pane — multiple panes render
    // simultaneously, with the inactive ones display:none. The
    // visible pane has data-testid="pane-contacts".
    const contacts = page.getByTestId('pane-contacts');
    const alice = contacts.getByText('Alice').first();
    await expect(alice).toBeVisible();
    await alice.click();

    // After click, ChatWorkspace's onOpenContact runs
    // channelDirectGetOrCreate, switches to chats tab, and mounts
    // ConversationPanel. The composer is the cleanest "panel open"
    // signal regardless of header layout.
    await expect(
      page.getByPlaceholder(/Type a message|输入消息/),
    ).toBeVisible();
  });

  test('Groups tab lists groups; tapping one opens the group chat', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /^Groups$|^群聊$/ }).click();

    const groups = page.getByTestId('pane-groups');
    const eng = groups.getByText('Engineering').first();
    await expect(eng).toBeVisible();
    await eng.click();

    await expect(
      page.getByPlaceholder(/Type a message|输入消息/),
    ).toBeVisible();
  });
});
