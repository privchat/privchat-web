export default async function webLogin(page, fixture) {
  await page.addInitScript(() => localStorage.setItem('privchat.web.lang', 'en'));
  await page.goto('http://127.0.0.1:5186/');
  await page.locator('#username').fill(fixture.accounts.owner.username);
  await page.locator('#password').fill(fixture.accounts.owner.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.locator('#username').waitFor({ state: 'detached', timeout: 30000 });
  await page.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 30000 });
  await page.getByText('Browser owner important message', { exact: true }).waitFor();
  return { stage: 'REAL_WEB_LOGIN_AND_GROUP_OPEN', text: (await page.locator('body').innerText()).slice(0, 6500) };
}
