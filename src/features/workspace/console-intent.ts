import type { WorkspaceApi } from './api';
import { PlatformApiError, PlatformHttpError } from '../../lib/platform-errors';

export interface PendingConsoleRequest { path: string; body: Record<string, unknown>; idKey: string }
export interface ConsoleIntentStore {
  load(): PendingConsoleRequest | undefined;
  save(pending: PendingConsoleRequest | undefined): void;
  assertScope(api: WorkspaceApi): void;
}

/** System-range envelope codes (busy / timeout / database …), network loss and protocol errors leave the outcome unknown. */
function definiteRejection(e: unknown): boolean {
  if (e instanceof PlatformApiError) return e.code === 401 || e.code === 403 || e.code >= 1000;
  return e instanceof PlatformHttpError && (e.status === 401 || e.status === 403);
}
/**
 * Keep the same ID and body until a response is received. A lost response is not permission to create new work.
 * Only a definite rejection of a request that never had an unknown outcome releases the key; once an attempt may
 * have been committed, later errors (including an expired login) keep it so recovery retries the same request.
 */
export class ConsoleIntent {
  private pending?: PendingConsoleRequest;
  private maybeCommitted = false;
  private recoveryError?: unknown;
  constructor(private readonly store?: ConsoleIntentStore) {
    try {
      this.pending = store?.load();
      this.maybeCommitted = !!this.pending;
    } catch (e) { this.recoveryError = e; }
  }
  get pendingRequest(): PendingConsoleRequest | undefined {
    return this.pending && structuredClone(this.pending);
  }
  async retry<T>(api: WorkspaceApi, retain?: (result: T) => boolean): Promise<T> {
    if (this.recoveryError) throw this.recoveryError;
    if (!this.pending) throw new Error('No request to retry');
    const {path, body, idKey} = this.pending;
    const {[idKey]: _id, ...input} = body;
    return this.run(api, path, input, idKey, retain);
  }
  async run<T>(api: WorkspaceApi, path: string, body: Record<string, unknown>, idKey = 'commandId', retain?: (result: T) => boolean): Promise<T> {
    if (this.recoveryError) throw this.recoveryError;
    this.store?.assertScope(api);
    if (!this.pending) { this.pending = JSON.parse(JSON.stringify({path, body: {...body, [idKey]: crypto.randomUUID()}, idKey})); this.maybeCommitted = false; }
    const pending = this.pending!;
    if (pending.path !== path || pending.idKey !== idKey || Object.keys(pending.body).length !== Object.keys(body).length+1 || Object.entries(body).some(([k,v]) => JSON.stringify(pending.body[k]) !== JSON.stringify(v))) throw new Error('Retry the original request');
    // Fail closed: never send a request whose recovery record could not be written.
    this.store?.save(pending);
    let result: T;
    let keep: boolean | undefined;
    try {
      result = await api.post<T>(pending.path, structuredClone(pending.body));
      keep = retain?.(result);
    }
    catch (e) {
      if (definiteRejection(e) && !this.maybeCommitted) { this.store?.save(undefined); this.pending = undefined; } else this.maybeCommitted = true;
      throw e;
    }
    this.maybeCommitted = true;
    if (!keep) { this.store?.save(undefined); this.pending = undefined; }
    return result;
  }
  get hasPending(): boolean { return this.pending !== undefined || !!this.recoveryError; }
}

