import { test, expect } from '@playwright/test';
import type { WorkspaceApi } from '../../src/features/workspace/api';
import { ConsoleIntent } from '../../src/features/workspace/console-intent';
import { persistentAssistantIntent } from '../../src/features/workspace/console-intent-storage';
import { getActiveAccountKey, setActiveAccountKey } from '../../src/lib/active-account';
import type { AccountKey } from '../../src/lib/account-key';
import { PlatformApiError, PlatformHttpError } from '../../src/lib/platform-errors';

const base = 'https://one.example/app';
const path = '/assistant/conversation/send';
const account = getActiveAccountKey();
const body = {text: 'Review fixed evidence', action: {kind: 'review', context: {workItemId: '5', workItemVersion: 7, evidenceNoteIds: ['8']}}};
function memoryStorage(): Storage {
  const rows = new Map<string, string>();
  return {
    get length() { return rows.size; },
    key: i => [...rows.keys()][i] ?? null,
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => { rows.set(key, value); },
    removeItem: key => { rows.delete(key); },
    clear: () => rows.clear(),
  };
}
function api(post: (path: string, body: Record<string, unknown>) => Promise<unknown>, server = base): WorkspaceApi {
  return {base: server, post} as WorkspaceApi;
}
test.afterEach(() => setActiveAccountKey(account));

test('writes full immutable request before HTTP, restores the identical path/key/body after loss', async () => {
  const storage = memoryStorage();
  const intent = persistentAssistantIntent(account, base, storage);
  const input = structuredClone(body);
  let sent: unknown;
  await expect(intent.run(api(async (p, b) => {
    const saved = JSON.parse(storage.getItem(storage.key(0)!)!);
    expect(saved).toEqual({path: p, body: b, idKey: 'requestId'});
    sent = b;
    throw new Error('response lost');
  }), path, input, 'requestId')).rejects.toThrow('response lost');
  input.action.context.evidenceNoteIds.push('changed');
  const restored = persistentAssistantIntent(account, base, storage);
  expect(restored.hasPending).toBe(true);
  const snapshot = restored.pendingRequest!;
  snapshot.body.text = 'mutated';
  await restored.retry(api(async (p, b) => { expect(p).toBe(path); expect(b).toEqual(sent); return {}; }));
  expect(restored.hasPending).toBe(false);
  expect(storage.length).toBe(0);
});

for (const failure of [new PlatformApiError(401, 'AUTH'), new PlatformHttpError(403, 'denied'), new PlatformApiError(10100, 'INVALID')]) {
  test(`restored unknown outcome survives ${failure.name} ${'code' in failure ? failure.code : failure.status}`, async () => {
    const storage = memoryStorage();
    await expect(persistentAssistantIntent(account, base, storage).run(api(async () => { throw new Error('lost'); }), path, body, 'requestId')).rejects.toThrow();
    const original = storage.getItem(storage.key(0)!);
    const restored = persistentAssistantIntent(account, base, storage);
    await expect(restored.retry(api(async () => { throw failure; }))).rejects.toThrow();
    expect(restored.hasPending).toBe(true);
    expect(storage.getItem(storage.key(0)!)).toBe(original);
  });
}

test('first definite rejection clears storage and permits corrected input with a new key', async () => {
  const storage = memoryStorage();
  const intent = persistentAssistantIntent(account, base, storage);
  let rejectedKey: unknown;
  await expect(intent.run(api(async (_p, b) => { rejectedKey = b.requestId; throw new PlatformApiError(10100, 'INVALID'); }), path, body, 'requestId')).rejects.toThrow();
  expect(intent.hasPending).toBe(false);
  expect(storage.length).toBe(0);
  await intent.run(api(async (_p, b) => { expect(b.requestId).not.toBe(rejectedKey); return {}; }), path, {text: 'corrected'}, 'requestId');
});

test('pending receipt and validation failures retain records; changed operations cannot replace them', async () => {
  const storage = memoryStorage();
  const intent = persistentAssistantIntent(account, base, storage);
  await intent.run(api(async () => ({status: 'pending'})), path, body, 'requestId', () => true);
  const restored = persistentAssistantIntent(account, base, storage);
  await expect(restored.run(api(async () => { throw new Error('must not send'); }), path, {text: 'changed'}, 'requestId')).rejects.toThrow('Retry the original');
  await expect(restored.retry(api(async () => ({})), () => { throw new Error('invalid receipt'); })).rejects.toThrow('invalid receipt');
  expect(storage.length).toBe(1);
  await restored.retry(api(async () => ({})));
  expect(storage.length).toBe(0);
});

test('account and normalized server scopes isolate records and fence stale callers', async () => {
  const storage = memoryStorage();
  const intent = persistentAssistantIntent(account, `${base}///`, storage);
  await expect(intent.run(api(async () => { throw new Error('lost'); }), path, body, 'requestId')).rejects.toThrow();
  const other = 'other-account' as AccountKey;
  expect(persistentAssistantIntent(other, base, storage).hasPending).toBe(false);
  expect(persistentAssistantIntent(account, 'https://two.example/app', storage).hasPending).toBe(false);
  setActiveAccountKey(other);
  let sent = false;
  const forbidden = api(async () => { sent = true; });
  await expect(intent.retry(forbidden)).rejects.toThrow('account or server changed');
  setActiveAccountKey(account);
  await expect(intent.retry(api(forbidden.post, 'https://two.example/app'))).rejects.toThrow('account or server changed');
  expect(sent).toBe(false);
  expect(storage.length).toBe(1);
});

test('write failure prevents HTTP; failed cleanup preserves identity across reload', async () => {
  const storage = memoryStorage();
  const write = storage.setItem;
  storage.setItem = () => { throw new Error('quota'); };
  const intent = persistentAssistantIntent(account, base, storage);
  let sends = 0;
  const service = api(async () => { sends++; return {}; });
  await expect(intent.run(service, path, body, 'requestId')).rejects.toThrow('quota');
  expect(sends).toBe(0);
  const id = intent.pendingRequest!.body.requestId;
  storage.setItem = write;
  storage.removeItem = () => { throw new Error('cleanup failed'); };
  await expect(intent.retry(service)).rejects.toThrow('cleanup failed');
  expect(intent.hasPending).toBe(true);
  expect(persistentAssistantIntent(account, base, storage).pendingRequest!.body.requestId).toBe(id);
});

test('unreadable or corrupt records fail closed without discarding stored data', async () => {
  const storage = memoryStorage();
  await expect(persistentAssistantIntent(account, base, storage).run(api(async () => { throw new Error('lost'); }), path, body, 'requestId')).rejects.toThrow();
  const key = storage.key(0)!;
  storage.setItem(key, '{corrupt');
  const intent = persistentAssistantIntent(account, base, storage);
  expect(intent.hasPending).toBe(true);
  await expect(intent.retry(api(async () => { throw new Error('must not send'); }))).rejects.toThrow();
  expect(storage.getItem(key)).toBe('{corrupt');
  storage.getItem = () => { throw new Error('blocked'); };
  const blocked = persistentAssistantIntent(account, base, storage);
  expect(blocked.hasPending).toBe(true);
  await expect(blocked.retry(api(async () => ({})))).rejects.toThrow('blocked');
});

test('existing nonpersistent console intents keep their rejection/retry semantics', async () => {
  const intent = new ConsoleIntent();
  await expect(intent.run(api(async () => { throw new PlatformApiError(4, 'BUSY'); }), '/x', {text: 'one'})).rejects.toThrow();
  const id = intent.pendingRequest!.body.commandId;
  await intent.run(api(async (_p, b) => { expect(b.commandId).toBe(id); return {}; }), '/x', {text: 'one'});
  expect(intent.hasPending).toBe(false);
});
