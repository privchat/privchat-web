import { test, expect } from '@playwright/test';
import type { PrivchatClient } from '@privchat/sdk';
import type { WorkspaceApi } from '../../src/features/workspace/api';
import { openPersonalAssistantChat } from '../../src/features/workspace/personal-chat';

const chat = {channelId: '9223372036854775000', assistantUid: '9223372036854775001', name: 'Personal Xiaowei', avatarUrl: '/avatar.png'};
function fixture(response: unknown = chat) {
  const calls: unknown[] = [];
  const api = {post: async (path: string, body: unknown) => {calls.push(['post', path, body]); return response;}} as Pick<WorkspaceApi, 'post'>;
  const client: Pick<PrivchatClient, 'bootstrapChannels'> = {bootstrapChannels: async () => {calls.push(['sdk.bootstrapChannels']); return [];}};
  const select = (...args: unknown[]) => {calls.push(['select', ...args]);};
  return {calls, api, client, select};
}

test('production personal-chat flow posts only open-chat, loads SDK and selects ordinary Direct with lossless IDs', async () => {
  const f = fixture();
  await openPersonalAssistantChat(f.api, f.client, f.select, () => true);
  expect(f.calls).toEqual([
    ['post', '/assistant/personal/open-chat', {}],
    ['sdk.bootstrapChannels'],
    ['select', chat.channelId, 1, {uid: chat.assistantUid, name: chat.name}],
  ]);
});

for (const response of [null, {}, {...chat, channelId: 84}, {...chat, assistantUid: ''}, {...chat, name: null}]) {
  test(`invalid open-chat contract cannot select a chat: ${JSON.stringify(response)}`, async () => {
    const f = fixture(response);
    await expect(openPersonalAssistantChat(f.api, f.client, f.select, () => true)).rejects.toThrow('Invalid personal assistant chat');
    expect(f.calls).toHaveLength(1);
  });
}

test('SDK failure does not navigate or fall back to REST conversation send', async () => {
  const f = fixture();
  f.client.bootstrapChannels = async () => {throw new Error('offline');};
  await expect(openPersonalAssistantChat(f.api, f.client, f.select, () => true)).rejects.toThrow('offline');
  expect(f.calls).toEqual([['post', '/assistant/personal/open-chat', {}]]);
});

test('open-chat authorization failure never loads SDK or navigates', async () => {
  const f = fixture();
  f.api.post = async () => {throw new Error('forbidden');};
  await expect(openPersonalAssistantChat(f.api, f.client, f.select, () => true)).rejects.toThrow('forbidden');
  expect(f.calls).toEqual([]);
});

for (const stage of ['before-request', 'after-response', 'after-sdk'] as const) {
  test(`account switch/unmount fences personal-chat navigation ${stage}`, async () => {
    const f = fixture();
    let current = stage !== 'before-request';
    if (stage === 'after-response') {
      f.api.post = async <T>() => {current = false; return chat as T;};
    } else if (stage === 'after-sdk') {
      f.client.bootstrapChannels = async () => {current = false; return [];};
    }
    await openPersonalAssistantChat(f.api, f.client, f.select, () => current);
    expect(f.calls.some(call => Array.isArray(call) && call[0] === 'select')).toBe(false);
    if (stage !== 'after-sdk') expect(f.calls).toEqual([]);
  });
}
