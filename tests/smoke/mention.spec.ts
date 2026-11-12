// MENTION_SPEC P0「客户端 @选择 UI」+ P1「@高亮」smoke.
//
// Drives the real composer wiring against the behavioural mock harness:
//   1. typing `@` opens the member picker, query filters it, mouse-select
//      inserts `@Name ` and SEND carries the right mentioned_user_ids
//      (decoded back through the real SDK envelope decoder);
//   2. an inbound message whose envelope mentions me renders the highlight;
//   3. keyboard (ArrowDown/Enter) selects and Escape dismisses the picker.
//
// No live server: group rosters + inbound payloads are seeded via
// `window.__privchatTest`.

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

interface MentionHarness {
  seed(input: unknown): void;
  lastMessageMentions(channelId: string): string[];
}

const ROSTER = [
  { user_id: 101, username: 'alice', nickname: 'Alice', display_name: 'Alice', user_type: 0, role: 'member', joined_at: 0, is_muted: false },
  { user_id: 102, username: 'bob', nickname: 'Bob', display_name: 'Bob', user_type: 0, role: 'member', joined_at: 0, is_muted: false },
  { user_id: 999, username: 'owner', nickname: 'Owner', display_name: 'Owner', user_type: 0, role: 'owner', joined_at: 0, is_muted: false },
];

async function seedRoster(page: import('@playwright/test').Page) {
  await page.evaluate((members) => {
    (window as unknown as { __privchatTest: MentionHarness }).__privchatTest.seed({
      groupMembers: { '900': members },
    });
  }, ROSTER);
}

async function openGroup(page: import('@playwright/test').Page) {
  await page.getByText('Engineering').first().click();
  const composer = page.getByPlaceholder(/Type a message|输入消息/);
  await expect(composer).toBeVisible();
  return composer;
}

test.describe('@mention composer', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('picker filters, mouse-select inserts, and send carries mentioned_user_ids', async ({
    page,
  }) => {
    await seedRoster(page);
    const composer = await openGroup(page);

    await composer.fill('@');
    await expect(page.getByTestId('mention-picker')).toBeVisible();
    await expect(page.getByTestId('mention-option')).toHaveCount(3);

    // Query narrows the roster to Alice.
    await composer.fill('@ali');
    await expect(page.getByTestId('mention-option')).toHaveCount(1);

    await page.getByTestId('mention-option').first().click();
    await expect(composer).toHaveValue('@Alice ');
    await expect(page.getByTestId('mention-picker')).toHaveCount(0);

    await composer.press('Enter');
    await expect(
      page.locator('[data-message-id]').filter({ hasText: '@Alice' }),
    ).toBeVisible();

    // The send path collected the selected id and encoded it into the
    // payload envelope — decode it back through the real SDK decoder.
    const ids = await page.evaluate(
      () => (window as unknown as { __privchatTest: MentionHarness }).__privchatTest.lastMessageMentions('900'),
    );
    expect(ids).toEqual(['101']);
  });

  test('keyboard ArrowDown + Enter selects the highlighted member; Escape dismisses', async ({
    page,
  }) => {
    await seedRoster(page);
    const composer = await openGroup(page);

    await composer.fill('@');
    await expect(page.getByTestId('mention-option')).toHaveCount(3);
    // First option active by default.
    await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');

    await composer.press('ArrowDown');
    await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await composer.press('Enter');
    await expect(composer).toHaveValue('@Bob ');

    // A fresh trigger opens the picker; Escape closes it without inserting.
    await composer.fill('@');
    await expect(page.getByTestId('mention-picker')).toBeVisible();
    await composer.press('Escape');
    await expect(page.getByTestId('mention-picker')).toHaveCount(0);
    await expect(composer).toHaveValue('@');
  });

  test('inbound message mentioning me is highlighted; a plain one is not', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const mentionEnv = new TextEncoder().encode(
        JSON.stringify({ content: 'hey @Me please review', mentioned_user_ids: ['self'] }),
      );
      const plainEnv = new TextEncoder().encode(
        JSON.stringify({ content: 'just a normal message', mentioned_user_ids: [] }),
      );
      (window as unknown as { __privchatTest: MentionHarness }).__privchatTest.seed({
        messages: {
          '900': [
            {
              id: 'r-m1', channel_id: '900', channel_type: 2,
              server_message_id: 'sm-mention-1', from_uid: '101', message_type: '0',
              content: 'hey @Me please review', payload: mentionEnv,
              timestamp: 1_700_000_000_000, pts: '1', status: 'received',
            },
            {
              id: 'r-m2', channel_id: '900', channel_type: 2,
              server_message_id: 'sm-plain-1', from_uid: '101', message_type: '0',
              content: 'just a normal message', payload: plainEnv,
              timestamp: 1_700_000_001_000, pts: '2', status: 'received',
            },
          ],
        },
      });
    });

    await openGroup(page);

    const mentioned = page.locator('[data-message-id="sm-mention-1"] [data-mentions-me="true"]');
    await expect(mentioned).toBeVisible();
    await expect(mentioned).toContainText(/Mentioned you|有人@你/);
    // The non-mention row carries no highlight marker at all.
    await expect(
      page.locator('[data-message-id="sm-plain-1"] [data-mentions-me]'),
    ).toHaveCount(0);
  });
});