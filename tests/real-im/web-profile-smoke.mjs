export default async function webProfileSmoke(page, fixture) {
  const owner = page.context().browser().contexts().flatMap(context => context.pages()).find(p => p.url().startsWith('http://127.0.0.1:5186/'));
  await owner.reload();
  await owner.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 30000 });
  await owner.getByRole('button', { name: 'Group info', exact: true }).click();
  await owner.getByTestId('group-introduction').waitFor({ timeout: 15000 });
  await owner.getByRole('button', { name: 'Edit', exact: true }).click();
  const description = `Static Web introduction ${Date.now()}\nSecond line`;
  await owner.getByTestId('group-settings-description-input').fill(description);
  await owner.getByRole('button', { name: 'Save', exact: true }).click();
  await owner.getByRole('dialog', { name: 'Edit group', exact: true }).waitFor({ state: 'detached' });
  await owner.getByTestId('group-introduction').filter({ hasText: description }).waitFor();
  await owner.reload();
  await owner.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 30000 });
  await owner.getByRole('button', { name: 'Group info', exact: true }).click();
  await owner.getByTestId('group-introduction').filter({ hasText: description }).waitFor();
  return { stage: 'REAL_STATIC_WEB_OWNER_PROFILE_RELOAD', groupId: fixture.group.groupId, description };
}
