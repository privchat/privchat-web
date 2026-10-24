// Real SDK setup against an explicitly selected disposable IM; no adapter or route stubs.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ChannelType, PrivchatClient } from '@privchat/sdk';

const root = process.env.PRIVCHAT_REAL_IM_FIXTURE;
if (!/^\/tmp\/privchat-features-im\.[A-Za-z0-9]+$/.test(root ?? '')) throw Error('Explicit disposable fixture directory required');
const fixture = JSON.parse(await readFile(`${root}/public.json`, 'utf8'));
if (fixture.host !== '127.0.0.1' || fixture.wsPort !== 58410) throw Error('Only the approved isolated IM is allowed');
if ((await stat(`${root}/accounts.json`)).mode & 0o077) throw Error('Use private fixture credentials');
const accounts = JSON.parse(await readFile(`${root}/accounts.json`, 'utf8'));
const clients = [];
try {
  const clientsByRole = {};
  for (const role of ['owner', 'admin', 'member']) {
    const client = new PrivchatClient({ url: `ws://127.0.0.1:${fixture.wsPort}/gate`, cache: { enabled: false }, reconnect: { enabled: false } });
    clients.push(client);
    await client.connect();
    const device_id = randomUUID();
    const login = await client.rpcCallTyped('account/auth/login', {
      username: accounts[role].username, password: accounts[role].password, device_id,
      device_info: { device_id, device_type: 'web', app_id: 'privchat-web', device_name: 'Isolated browser fixture', app_version: '1.0.0' },
    });
    await client.authenticate(String(login.user_id), login.token, device_id);
    clientsByRole[role] = client;
  }
  const name = `Browser ${Date.now()}`;
  const created = await clientsByRole.owner.groupCreate(name, 'Browser initial introduction');
  const id = String(created.group_id);
  if (id === '14') throw Error('Reserved mobile group must not be reused');
  await clientsByRole.owner.groupMemberAdd(Number(id), Number(accounts.admin.user_id), 'member');
  await clientsByRole.owner.groupMemberAdd(Number(id), Number(accounts.member.user_id), 'member');
  await clientsByRole.owner.groupRoleSet(Number(id), Number(accounts.owner.user_id), Number(accounts.admin.user_id), 'admin');
  const messages = [];
  for (const role of ['owner', 'admin']) {
    const content = `Browser ${role} important message`;
    const sent = await clientsByRole[role].sendTextMessage({ channel_id: id, channel_type: ChannelType.Group, from_uid: String(accounts[role].user_id), content });
    if (sent.status !== 'sent') throw Error('Fixture message was not acknowledged');
    messages.push({ role, content, messageId: String(sent.response.server_message_id) });
  }
  await writeFile(`${root}/browser-group.json`, JSON.stringify({ groupId: id, channelId: id, name, messages, noProduction: true }, null, 2));
  console.log(`Real browser group prepared: ${id}; reserved mobile group untouched.`);
} finally {
  for (const client of clients) await client.dispose();
}
