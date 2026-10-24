import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ChannelType, PrivchatClient } from '@privchat/sdk';

const root = process.env.PRIVCHAT_REAL_IM_FIXTURE;
if (!/^\/tmp\/privchat-features-im\.[A-Za-z0-9]+$/.test(root ?? '')) throw Error('Explicit disposable fixture required');
const fixture = JSON.parse(await readFile(`${root}/public.json`, 'utf8'));
const group = JSON.parse(await readFile(`${root}/browser-group.json`, 'utf8'));
if (fixture.wsPort !== 58410 || fixture.host !== '127.0.0.1' || group.groupId === '14') throw Error('Reserved/non-isolated fixture');
const { owner } = JSON.parse(await readFile(`${root}/accounts.json`, 'utf8'));
const client = new PrivchatClient({ url: 'ws://127.0.0.1:58410/gate', cache: { enabled: false } });
try {
  await client.connect();
  const device_id = randomUUID();
  const login = await client.rpcCallTyped('account/auth/login', {
    username: owner.username, password: owner.password, device_id,
    device_info: { device_id, device_type: 'web', app_id: 'privchat-web', device_name: 'Isolated history fixture', app_version: '1.0.0' },
  }, { timeoutMs: 30000 });
  await client.authenticate(String(login.user_id), login.token, device_id, { timeoutMs: 30000 });
  for (let index = 0; index < 120; index++) {
    const result = await client.sendTextMessage({ channel_id: group.groupId, channel_type: ChannelType.Group, from_uid: String(owner.user_id), content: `Browser history fixture ${index}` });
    if (result.status !== 'sent') throw Error('History fixture was not acknowledged');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await writeFile(`${root}/browser-history.json`, JSON.stringify({ groupId: group.groupId, acknowledgedMessages: 120, noProduction: true }, null, 2));
  console.log(`Sent 120 real history messages to browser-only group ${group.groupId}`);
} finally { await client.dispose(); }
