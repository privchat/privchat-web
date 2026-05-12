// Smoke: voice bubble DOM-state transitions.
//
// We deliberately do NOT assert on `<audio>` actually playing —
// chromium autoplay-blocking + the harness handing back fake
// `blob:mock/...` URLs makes a real-playback assertion intermittent
// and headless-CI hostile. Instead we assert the bubble renders the
// idle affordance correctly, that a click advances the state machine
// off `idle`, and that a record with no playable handle falls
// through to the placeholder chip.

import { expect, test } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

const VOICE_CHANNEL = '1001';

const voicePayload = (m: {
  file_id?: string;
  url?: string;
  duration?: number;
}): number[] => {
  const env = { metadata: { type: 'voice', ...m } };
  return Array.from(new TextEncoder().encode(JSON.stringify(env)));
};

test.describe('voice bubble', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('renders idle Play affordance with duration label', async ({ page }) => {
    await page.evaluate((payload) => {
      const harness = (window as unknown as {
        __privchatTest: {
          pushIncomingMessage: (r: Record<string, unknown>) => void;
        };
      }).__privchatTest;
      harness.pushIncomingMessage({
        channel_id: '1001',
        channel_type: 1,
        server_message_id: 'sm-voice-1',
        from_uid: '101',
        message_type: '1',
        content: '',
        payload: new Uint8Array(payload),
        timestamp: Date.now(),
        pts: '6',
        status: 'received',
      });
    }, voicePayload({ file_id: 'f-voice-1', duration: 8 }));

    // Open the direct conversation that contains the voice row.
    await page.getByText('hello there').first().click();

    const bubble = page
      .locator(`[data-testid="voice-bubble"][data-message-id="sm-voice-1"]`)
      .first();
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveAttribute('data-state', 'idle');
    // Duration formatted from metadata header (no live audio yet).
    await expect(bubble).toContainText('00:08');
  });

  test('clicking the bubble advances state off idle', async ({ page }) => {
    await page.evaluate((payload) => {
      const harness = (window as unknown as {
        __privchatTest: {
          pushIncomingMessage: (r: Record<string, unknown>) => void;
        };
      }).__privchatTest;
      harness.pushIncomingMessage({
        channel_id: '1001',
        channel_type: 1,
        server_message_id: 'sm-voice-2',
        from_uid: '101',
        message_type: '1',
        content: '',
        payload: new Uint8Array(payload),
        timestamp: Date.now(),
        pts: '7',
        status: 'received',
      });
    }, voicePayload({ file_id: 'f-voice-2', duration: 5 }));

    await page.getByText('hello there').first().click();

    const bubble = page
      .locator(`[data-testid="voice-bubble"][data-message-id="sm-voice-2"]`)
      .first();
    await expect(bubble).toHaveAttribute('data-state', 'idle');
    await bubble.click();
    // Whatever the codec verdict ends up being (loading / playing /
    // error) — the state machine should leave idle. That's the only
    // assertion that's stable in CI without a real audio stream.
    await expect(bubble).not.toHaveAttribute('data-state', 'idle');
  });

  test('falls back to placeholder when payload has no file_id', async ({
    page,
  }) => {
    await page.evaluate((payload) => {
      const harness = (window as unknown as {
        __privchatTest: {
          pushIncomingMessage: (r: Record<string, unknown>) => void;
        };
      }).__privchatTest;
      harness.pushIncomingMessage({
        channel_id: '1001',
        channel_type: 1,
        server_message_id: 'sm-voice-3',
        from_uid: '101',
        message_type: '1',
        content: '',
        payload: new Uint8Array(payload),
        timestamp: Date.now(),
        pts: '8',
        status: 'received',
      });
    }, voicePayload({ duration: 3 })); // no file_id, no url

    await page.getByText('hello there').first().click();

    // Without file_id, the metadata projector returns undefined and
    // the row renders as a plain text bubble. There should be no
    // voice-bubble affordance for that message.
    const voiceBubble = page.locator(
      `[data-testid="voice-bubble"][data-message-id="sm-voice-3"]`,
    );
    await expect(voiceBubble).toHaveCount(0);
  });
});
