import type { AccountKey } from '../../lib/account-key';
import { getActiveAccountKey } from '../../lib/active-account';
import { normalizePlatformBaseUrl } from '../../lib/platform-base-url';
import { ConsoleIntent, type PendingConsoleRequest } from './console-intent';

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
