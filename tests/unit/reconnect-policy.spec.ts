import { expect, test } from '@playwright/test';
import { retainChatWorkspace } from '../../src/features/chat/reconnect-policy';

test('retains only an existing workspace during transient reconnect states', () => {
  for (const state of ['reconnecting', 'connecting', 'connected', 'authenticating'] as const) {
    expect(retainChatWorkspace(state, 'owner')).toBe(true);
    expect(retainChatWorkspace(state, undefined)).toBe(false);
    expect(retainChatWorkspace(state, '')).toBe(false);
  }
  for (const state of ['disconnected', 'closing'] as const) {
    expect(retainChatWorkspace(state, 'owner')).toBe(false);
    expect(retainChatWorkspace(state, undefined)).toBe(false);
  }
  expect(retainChatWorkspace('authenticated', 'owner')).toBe(true);
});
