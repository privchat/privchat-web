export default async function h5Login(page, fixture) {
  for (const old of page.context().pages()) if (old.url().includes('127.0.0.1:10086')) await old.close();
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const h5 = await context.newPage();
  await h5.addInitScript(() => localStorage.setItem('privchat.h5.locale', 'en'));
  await h5.goto('http://127.0.0.1:10086/');
  await h5.locator('input[placeholder="Username"]').fill(fixture.accounts.admin.username);
  await h5.locator('input[placeholder="Password"]').fill(fixture.accounts.admin.password);
  await h5.getByText('Sign in', { exact: true }).click();
  await h5.locator('.conv-item__title').filter({ hasText: fixture.group.name }).waitFor({ timeout: 30000 });
  await h5.locator('.conv-item__title').filter({ hasText: fixture.group.name }).click();
  await h5.getByText('Browser owner important message', { exact: true }).waitFor({ timeout: 30000 });
  return { stage: 'REAL_H5_LOGIN_AND_GROUP_OPEN', text: (await h5.locator('body').innerText()).slice(0, 5000) };
}
