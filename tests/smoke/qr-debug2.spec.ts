import { expect, test, type Page } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

async function callHarness(page: Page, method: string, args?: unknown) {
  return page.evaluate(
    ([m, a]) => {
      const t = (window as any).__privchatTest;
      return a === undefined ? t[m]() : t[m](a);
    },
    [method, args] as [string, unknown],
  );
}

test('mirror real test 4', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__privchatForcedMode = 'platform';
    w.__privchatForcedPlatformBaseUrl = `${window.location.origin}/__fake-platform/app`;
    window.localStorage.setItem('privchat.web.accounts', JSON.stringify({
      accounts: { '0123456789abcdef': { url: 'ws://gw-alice/', user_id: '900001', device_id: 'dev-alice', alias: 'Alice', added_at: 1700000000000, mode: 'platform', platform_base_url: 'https://app.example.com/app' } },
      active: '0123456789abcdef',
    }));
  });
  await gotoAppFresh(page);
  await page.getByTestId('account-switcher-trigger').click();
  await page.getByTestId('account-switcher-add').click();

  await callHarness(page, 'qrInstallScriptedFactory', {
    connect: { kind: 'ok' },
    rpc: { kind: 'ok', sceneId: 'scene-exp', qrToken: 'qr_exp', expiresAt: Date.now() + 90_000 },
  });
  await page.getByTestId('login-tab-qr').click();
  await expect(page.getByTestId('qr-canvas')).toBeVisible();

  const before = await callHarness(page, 'qrInspect');
  console.log('BEFORE:', JSON.stringify(before));

  const pushResult = await callHarness(page, 'qrInjectPush', {
    topic: 'qr_login.expired',
    payloadJson: JSON.stringify({ event: 'qr_login.expired', scene_id: 'scene-exp', state: 'expired', data: null }),
  });
  console.log('PUSH:', JSON.stringify(pushResult));

  await page.waitForTimeout(300);

  const after = await callHarness(page, 'qrInspect');
  console.log('AFTER:', JSON.stringify(after));

  const dom = await page.evaluate(() => ({
    hasRegenerate: !!document.querySelector('[data-testid="qr-regenerate"]'),
    panelText: document.querySelector('[data-testid="login-qr-panel"]')?.textContent,
  }));
  console.log('DOM:', JSON.stringify(dom));

  await expect(page.getByTestId('qr-regenerate')).toBeVisible();
});
