export default async function introductionLive(page, fixture) {
  const pages = page.context().browser().contexts().flatMap(context => context.pages());
  const owner = pages.find(p => p.url().startsWith('http://127.0.0.1:5186/'));
  const h5 = pages.find(p => p.url().includes('10086/#/pages/group-info/index') || p.url().includes('10086/#/pages/chat/index'));
  if (!owner || !h5) throw Error('Run login and pin stages first');
  const check = (ok, text) => { if (!ok) throw Error(text); };
  const contexts = [];
  let checkpoint = 'initial static reload';
  const loginWeb = async role => {
    checkpoint = `Web ${role} login`;
    const context = await page.context().browser().newContext(); contexts.push(context);
    const peer = await context.newPage();
    await peer.addInitScript(() => localStorage.setItem('privchat.web.lang', 'en'));
    await peer.goto('http://127.0.0.1:5186/');
    await peer.locator('#username').fill(fixture.accounts[role].username);
    await peer.locator('#password').fill(fixture.accounts[role].password);
    await peer.getByRole('button', { name: 'Login', exact: true }).click();
    await peer.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 30000 });
    await peer.getByRole('button', { name: 'Group info', exact: true }).click();
    await peer.getByTestId('group-introduction').waitFor();
    return peer;
  };
  const saveWeb = async (peer, text) => {
    await peer.getByRole('button', { name: 'Edit', exact: true }).click();
    await peer.getByTestId('group-settings-description-input').fill(text);
    await peer.getByRole('button', { name: 'Save', exact: true }).click();
    await peer.getByRole('dialog', { name: 'Edit group', exact: true }).waitFor({ state: 'detached' });
  };
  const loginH5Member = async () => {
    checkpoint = 'H5 member login and cold pin';
    const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); contexts.push(context);
    const peer = await context.newPage();
    await peer.addInitScript(() => localStorage.setItem('privchat.h5.locale', 'en'));
    await peer.goto('http://127.0.0.1:10086/');
    await peer.locator('input[placeholder="Username"]').fill('');
    await peer.locator('input[placeholder="Username"]').pressSequentially(fixture.accounts.member.username);
    await peer.locator('input[placeholder="Password"]').fill('');
    await peer.locator('input[placeholder="Password"]').pressSequentially(fixture.accounts.member.password);
    await peer.locator('input[placeholder="Password"]').blur();
    await peer.getByText('Sign in', { exact: true }).click();
    try {
      await peer.locator('input[placeholder="Username"]').waitFor({ state: 'hidden', timeout: 15000 });
    } catch {
      // One visible UI retry for a transient real login timeout; never inject auth.
      await peer.getByText('Sign in', { exact: true }).click();
    }
    await peer.locator('.conv-item__title').filter({ hasText: fixture.group.name }).click({ timeout: 30000 });
    const original = fixture.group.messages[0].content;
    check(await peer.locator('.msg-row').filter({ hasText: original }).count() === 0, 'H5 cold pin target already loaded');
    check(await peer.locator('.chat__pinned-unpin').count() === 0, 'H5 member sees unpin');
    await peer.locator('.chat__pinned-text').click();
    await peer.locator('.nut-actionsheet').getByText('置顶消息', { exact: true }).nth(1).click();
    await peer.locator('.msg-row.is-flash').filter({ hasText: original }).waitFor({ timeout: 15000 });
    await peer.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/cold-pin-h5.png' });
    await peer.getByText('⋯', { exact: true }).click();
    await peer.locator('.nut-actionsheet').getByText('群聊信息', { exact: true }).click();
    await peer.getByText('群介绍', { exact: true }).waitFor();
    await peer.getByText('群介绍', { exact: true }).click();
    check(await peer.locator('textarea:visible').count() === 0, 'H5 member can edit introduction');
    return peer;
  };
  try {
    await owner.reload();
    // Enter through the production conversation so its channel subscription is active.
    await h5.goto(`http://127.0.0.1:10086/#/pages/chat/index?channel_id=${fixture.group.groupId}&channel_type=2`);
    await h5.locator('.chat__pinned-text').waitFor();
    check(await owner.locator('script[src*="@vite/client"]').count() === 0, 'Use the static Web production build');
    check(await h5.locator('script[src*="@vite/client"]').count() === 0, 'Use the static H5 production build');
    if (h5.url().includes('/pages/chat/index')) {
      await h5.getByText('⋯', { exact: true }).click();
      await h5.locator('.nut-actionsheet').getByText('群聊信息', { exact: true }).click();
    }
    await h5.getByText('群介绍', { exact: true }).waitFor();
    await h5.getByText('尚未加载', { exact: true }).waitFor({ state: 'hidden' });
    checkpoint = 'owner group selection';
    await owner.getByText(fixture.group.name, { exact: true }).first().click();
    await owner.getByRole('button', { name: 'Group info', exact: true }).click();
    await owner.getByTestId('group-introduction').waitFor();
    const member = await loginWeb('member');
    check(await member.getByRole('button', { name: 'Edit', exact: true }).count() === 0, 'Member introduction is editable');
    const h5Member = await loginH5Member();
    const first = `Owner introduction ${Date.now()}\nSecond line`;
    checkpoint = 'owner multiline update and online propagation';
    await saveWeb(owner, first);
    await h5.getByText(first, { exact: true }).waitFor({ timeout: 8000 });
    await member.getByTestId('group-introduction').filter({ hasText: first }).waitFor({ timeout: 8000 });
    await h5Member.getByText(first, { exact: true }).waitFor({ timeout: 8000 });
    await h5.getByText('群介绍', { exact: true }).click();
    const second = `Admin introduction ${Date.now()}`;
    checkpoint = 'H5 admin update';
    await h5.locator('textarea[placeholder="填写群介绍，清空后保存可删除介绍"]').fill(second);
    await h5.getByText('保存', { exact: true }).click();
    await owner.getByTestId('group-introduction').filter({ hasText: second }).waitFor({ timeout: 8000 });
    await member.getByTestId('group-introduction').filter({ hasText: second }).waitFor({ timeout: 8000 });
    await h5Member.getByText(second, { exact: true }).waitFor({ timeout: 8000 });
    await h5.getByText('群介绍', { exact: true }).click();
    await h5.locator('textarea[placeholder="填写群介绍，清空后保存可删除介绍"]').fill('');
    await h5.getByText('保存', { exact: true }).click();
    await owner.waitForFunction(() => document.querySelector('[data-testid="group-introduction"]')?.textContent === '—', undefined, { timeout: 8000 });
    const final = `Persisted browser introduction ${Date.now()}`;
    await saveWeb(owner, final);
    await h5.getByText(final, { exact: true }).waitFor({ timeout: 8000 });
    await owner.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/introduction-web.png' });
    await h5.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/introduction-h5.png' });
    await member.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/introduction-member-readonly.png' });
    await h5Member.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/introduction-h5-member-readonly.png' });
    await owner.reload();
    await owner.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 30000 });
    await owner.getByRole('button', { name: 'Group info', exact: true }).click();
    await owner.getByTestId('group-introduction').filter({ hasText: final }).waitFor();
    await h5.reload();
    await h5.getByText(final, { exact: true }).waitFor({ timeout: 30000 });
    return { stage: 'REAL_INTRODUCTION_TWO_CLIENTS_AND_MEMBER', groupId: fixture.group.groupId, finalDescription: final, checks: ['H5 member cold pin hydrates and flashes old original', 'H5 member cannot unpin', 'owner edits multiline', 'H5 online invalidation', 'Web and H5 members see online and cannot edit', 'H5 admin edits', 'Web owner/member see online', 'empty string clears', 'Web and H5 reload retain value'] };
  } catch (error) {
    const visible = await Promise.all([owner, h5, ...contexts.flatMap(context => context.pages())].map(async peer => ({ url: peer.url(), text: (await peer.locator('body').innerText()).slice(-5000) })));
    throw Error(`[${checkpoint}] ${error.message}\nVisible UI: ${JSON.stringify(visible)}`);
  } finally { for (const context of contexts) await context.close(); }
}
