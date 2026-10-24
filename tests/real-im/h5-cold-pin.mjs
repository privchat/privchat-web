export default async function h5ColdPin(page, fixture) {
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const peer = await context.newPage();
  try {
    await peer.addInitScript(() => localStorage.setItem('privchat.h5.locale', 'en'));
    await peer.goto('http://127.0.0.1:10086/');
    await peer.locator('input[placeholder="Username"]').fill('');
    await peer.locator('input[placeholder="Username"]').pressSequentially(fixture.accounts.member.username);
    await peer.locator('input[placeholder="Password"]').fill('');
    await peer.locator('input[placeholder="Password"]').pressSequentially(fixture.accounts.member.password);
    await peer.locator('input[placeholder="Password"]').blur();
    await peer.getByText('Sign in', { exact: true }).click();
    try { await peer.locator('input[placeholder="Username"]').waitFor({ state: 'hidden', timeout: 15000 }); }
    catch { await peer.getByText('Sign in', { exact: true }).click(); }
    await peer.locator('.conv-item__title').filter({ hasText: fixture.group.name }).click({ timeout: 30000 });
    const target = fixture.group.messages[0];
    if (await peer.locator('.msg-row').filter({ hasText: target.content }).count()) throw Error('Not a cold target');
    if (await peer.locator('.chat__pinned-unpin').count()) throw Error('Member sees unpin');
    await peer.locator('.chat__pinned-text').click();
    await peer.locator('.nut-actionsheet').getByText('置顶消息', { exact: true }).last().click();
    const original = peer.locator('.msg-row.is-flash').filter({ hasText: target.content });
    await original.waitFor({ timeout: 15000 });
    await peer.waitForFunction(text => [...document.querySelectorAll('.msg-row')].some(row => {
      const rect = row.getBoundingClientRect();
      return row.textContent.includes(text) && rect.top < innerHeight && rect.bottom > 0;
    }), target.content, { timeout: 5000 });
    await peer.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/cold-pin-h5.png' });
    return { stage: 'REAL_H5_COLD_PIN_FETCH_SCROLL_HIGHLIGHT', groupId: fixture.group.groupId, messageId: target.messageId, checks: ['fresh member normal login', 'original absent from initial history', 'actual pin jump hydrates original', 'original scrolls into viewport and highlights', 'member cannot unpin'] };
  } catch (error) { throw Error(`${error.message}\nVisible UI: ${await peer.locator('body').innerText()}`); }
  finally { await context.close(); }
}
