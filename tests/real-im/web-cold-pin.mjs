export default async function webColdPin(page, fixture) {
  const context = await page.context().browser().newContext();
  let peer;
  try {
    peer = await context.newPage();
    await peer.addInitScript(() => localStorage.setItem('privchat.web.lang', 'en'));
    await peer.goto('http://127.0.0.1:5186/');
    await peer.locator('#username').fill(fixture.accounts.member.username);
    await peer.locator('#password').fill(fixture.accounts.member.password);
    await peer.getByRole('button', { name: 'Login', exact: true }).click();
    await peer.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 30000 });
    const pinButtons = peer.getByRole('button').filter({ hasText: 'Pinned message' });
    await pinButtons.nth(1).waitFor();
    if (await peer.getByRole('button', { name: 'Unpin', exact: true }).count()) throw Error('Member sees unpin action');
    const target = fixture.group.messages[0];
    if (await peer.locator(`[data-message-id="${target.messageId}"]`).count()) throw Error('Older target is already in the initial window; not a cold jump test');
    await pinButtons.nth(1).click();
    await peer.locator(`[data-message-id="${target.messageId}"]`).filter({ hasText: target.content }).waitFor({ state: 'visible', timeout: 15000 });
    await peer.waitForFunction(id => {
      const rect = document.querySelector(`[data-message-id="${id}"]`)?.getBoundingClientRect();
      return rect && rect.top < innerHeight && rect.bottom > 0;
    }, target.messageId, { timeout: 5000 });
    await peer.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/cold-pin-web.png' });
    await peer.getByTestId('pinned-hide').click();
    await peer.getByTestId('pinned-show').waitFor();
    await peer.reload();
    await peer.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 30000 });
    await peer.getByRole('button').filter({ hasText: 'Pinned message' }).nth(1).waitFor();
    return { stage: 'REAL_WEB_COLD_PIN_JUMP_AND_MEMBER', checks: ['member reads two pins but cannot unpin', 'target absent from initial message window', 'pin hydrates and locates old original via real IM', 'local hide leaves two pins after reload'], groupId: fixture.group.groupId };
  } catch (error) {
    await peer?.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/cold-pin-web-failure.png' });
    throw Error(`${error.message}\nVisible UI: ${await peer?.locator('body').innerText()}`);
  } finally { await context.close(); }
}
