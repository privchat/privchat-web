import type { AccountKey } from '../../lib/account-key';
import { getActiveAccountKey } from '../../lib/active-account';
import { normalizePlatformBaseUrl } from '../../lib/platform-base-url';
import { ConsoleIntent, type PendingConsoleRequest } from './console-intent';
import type { WorkspaceApi } from './api';

export function employeeCreationIntent(api: WorkspaceApi, workspaceId: string) {
  const account = getActiveAccountKey();
  const key = 'privchat.web.employee.pending.' + JSON.stringify([account, api.base, workspaceId]);
  return new ConsoleIntent({
    load() {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const saved = JSON.parse(raw) as PendingConsoleRequest;
      if (saved?.path !== '/agent/agents' || saved.idKey !== 'requestId' ||
          !saved.body?.requestId || saved.body.workdirBindingId !== '') throw new Error('Invalid employee recovery record');
      return saved;
    },
    save(pending) {
      if (pending) localStorage.setItem(key, JSON.stringify(pending));
      else localStorage.removeItem(key);
    },
    assertScope(current) {
      if (current !== api || getActiveAccountKey() !== account) throw new Error('Employee account or server changed');
    },
  });
}

/** A single recovery record, not a queue. Tokens and transient form state are never stored. */
export function persistentAssistantIntent(accountKey: AccountKey, base: string, storage?: Storage): ConsoleIntent {
  const server = normalizePlatformBaseUrl(base);
  const key = `privchat.web.assistant.pending.${accountKey}.${encodeURIComponent(server)}`;
  const store = () => storage ?? window.localStorage;
  return new ConsoleIntent({
    load() {
      const raw = store().getItem(key);
      if (raw === null) return undefined;
      const saved = JSON.parse(raw) as PendingConsoleRequest;
      // Corrupt records must not silently permit a new identity.
      if (!saved || saved.path !== '/assistant/conversation/send' || saved.idKey !== 'requestId' ||
          !saved.body || typeof saved.body !== 'object' || Array.isArray(saved.body) ||
          typeof saved.body.requestId !== 'string' || !saved.body.requestId || typeof saved.body.text !== 'string') {
        throw new Error('Invalid assistant recovery record');
      }
      return saved;
    },
    save(pending) {
      if (pending) store().setItem(key, JSON.stringify(pending));
      else store().removeItem(key);
    },
    assertScope(api) {
      if (getActiveAccountKey() !== accountKey || api.base !== server) throw new Error('Assistant account or server changed');
    },
  });
}
