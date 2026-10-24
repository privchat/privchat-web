export default async function coldProfileReconciliation(page, fixture) {
  const pages = page.context().browser().contexts().flatMap(context => context.pages());
  const owner = pages.find(peer => peer.url().startsWith('http://127.0.0.1:5186/'));
  const h5 = pages.find(peer => peer.url().includes('127.0.0.1:10086/'));
  await owner.reload();
  await owner.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 30000 });
  await owner.getByRole('button', { name: 'Group info', exact: true }).click();
  await owner.getByTestId('group-introduction').waitFor();
  await h5.goto(`http://127.0.0.1:10086/#/pages/group-info/index?channel_id=${fixture.group.groupId}`);
  await h5.reload();
  await h5.getByText('群介绍', { exact: true }).waitFor();
  await h5.getByText('尚未加载', { exact: true }).waitFor({ state: 'hidden' });
  const description = `Cold route reconciliation ${Date.now()}`;
  await owner.getByRole('button', { name: 'Edit', exact: true }).click();
  await owner.getByTestId('group-settings-description-input').fill(description);
  await owner.getByRole('button', { name: 'Save', exact: true }).click();
  await owner.getByRole('dialog', { name: 'Edit group', exact: true }).waitFor({ state: 'detached' });
  const started = Date.now();
  await h5.getByText(description, { exact: true }).waitFor({ timeout: 35000 });
  return { stage: 'REAL_H5_COLD_PROFILE_BOUNDED_RECONCILIATION', groupId: fixture.group.groupId, elapsedMs: Date.now() - started, description, limitation: 'Cold info route has no chat subscription; existing visible-page reconciliation, not immediate channel invalidation, repairs it.' };
}
