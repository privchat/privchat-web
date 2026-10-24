export default async function pinLive(page, fixture) {
  const pages = page.context().browser().contexts().flatMap(context => context.pages());
  const owner = pages.find(p => p.url().startsWith('http://127.0.0.1:5186/'));
  const admin = pages.find(p => p.url().includes('10086/#/pages/chat/index') || p.url().includes('10086/#/pages/group-info/index'));
  if (!owner || !admin) throw Error('Run real Web/H5 login stages first');
  const check = (ok, text) => { if (!ok) throw Error(text); };
  const first = fixture.group.messages[0];
  const second = fixture.group.messages[1];
  if (await owner.getByRole('button', { name: 'Close', exact: true }).count()) await owner.getByRole('button', { name: 'Close', exact: true }).click();
  if (!admin.url().includes('/pages/chat/index')) {
    await admin.goto(`http://127.0.0.1:10086/#/pages/chat/index?channel_id=${fixture.group.groupId}&channel_type=2`);
    await admin.locator('.chat__pinned-text').waitFor();
  }
  // Begin this independent gate with a fresh authenticated production client.
  await admin.reload();
  await admin.locator('.chat__pinned-text').waitFor();
  if (await owner.locator(`[data-message-id="${first.messageId}"]`).count() === 0) {
    await owner.getByRole('button').filter({ hasText: 'Pinned message' }).last().click();
    await owner.locator(`[data-message-id="${first.messageId}"]`).waitFor();
  }
  if (await admin.locator('.msg-row').filter({ hasText: first.content }).count() === 0) {
    await admin.locator('.chat__pinned-text').click();
    await admin.locator('.nut-actionsheet').getByText('置顶消息', { exact: true }).last().click();
    await admin.locator('.msg-row').filter({ hasText: first.content }).waitFor();
  }
  await owner.locator(`[data-message-id="${first.messageId}"]`).getByRole('button', { name: 'actions', exact: true }).click({ force: true });
  if (await owner.getByRole('menuitem', { name: 'Pin', exact: true }).count()) await owner.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  else await owner.keyboard.press('Escape');
  await admin.locator('.chat__pinned-text').waitFor({ timeout: 8000 });
  const hadTwo = (await admin.locator('.chat__pinned-text').innerText()).startsWith('2');
  if (hadTwo) {
    await admin.locator('.chat__pinned-unpin').click();
    await owner.waitForFunction(() => document.querySelectorAll('button[aria-label="Unpin"]').length === 1, undefined, { timeout: 8000 });
    await admin.waitForFunction(() => document.querySelector('.chat__pinned-text')?.textContent?.startsWith('1'), undefined, { timeout: 8000 });
  }
  check(await admin.locator('.chat__pinned-unpin').count() === 0, 'Admin can unpin an owner pin');
  await admin.locator('.msg-row').filter({ hasText: first.content }).dispatchEvent('longpress');
  check(await admin.locator('.nut-actionsheet').getByText('取消置顶', { exact: true }).count() === 0, 'Owner pin exposes admin unpin in message menu');
  await admin.locator('.nut-actionsheet').getByText('取消', { exact: true }).click();
  await admin.locator('.msg-row').filter({ hasText: second.content }).dispatchEvent('longpress');
  if (await admin.locator('.nut-actionsheet').getByText('置顶', { exact: true }).count()) await admin.locator('.nut-actionsheet').getByText('置顶', { exact: true }).click();
  else await admin.locator('.nut-actionsheet').getByText('取消', { exact: true }).click();
  await owner.waitForFunction(() => document.querySelectorAll('button[aria-label="Unpin"]').length === 2, undefined, { timeout: 8000 });
  await owner.getByTestId('pinned-hide').click();
  check(await owner.getByTestId('pinned-show').isVisible(), 'Web local hide is not recoverable');
  check((await admin.locator('.chat__pinned-text').innerText()).startsWith('2'), 'Web hide mutated shared pins');
  await owner.getByTestId('pinned-show').click();
  await admin.getByTestId('pinned-hide').click();
  check(await admin.getByTestId('pinned-show').isVisible(), 'H5 local hide is not recoverable');
  check(await owner.getByRole('button', { name: 'Unpin', exact: true }).count() === 2, 'H5 hide mutated shared pins');
  await admin.getByTestId('pinned-show').click();
  await admin.locator('.chat__pinned-text').click();
  await admin.locator('.nut-actionsheet').getByText(first.content, { exact: true }).click();
  await admin.locator('.msg-row.is-flash').filter({ hasText: first.content }).waitFor();
  await owner.getByRole('button').filter({ hasText: first.content }).click();
  await owner.locator(`[data-message-id="${first.messageId}"]`).waitFor({ state: 'visible' });
  await owner.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/pins-web.png' });
  await admin.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/pins-h5.png' });
  return { stage: 'REAL_PIN_TWO_CLIENTS_LOCAL_HIDE_JUMP', groupId: fixture.group.groupId, checks: ['Web owner pins', 'H5 admin receives online', 'admin cannot unpin owner', 'H5 admin pins', 'Web receives online', 'both local hides leave shared pins intact', 'both hides can reopen', 'H5 pin list jumps and flashes original', 'Web pin opens original'] };
}
