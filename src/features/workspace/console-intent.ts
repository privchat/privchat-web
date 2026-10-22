import { WorkspaceApi } from './api';
import { PlatformApiError, PlatformHttpError } from '@/lib/platform-errors';

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
  private pending?: {path: string; body: Record<string, unknown>};
  private maybeCommitted = false;
  async run<T>(api: WorkspaceApi, path: string, body: Record<string, unknown>, idKey = 'commandId', retain?: (result: T) => boolean): Promise<T> {
    if (!this.pending) { this.pending = {path, body: {...body, [idKey]: crypto.randomUUID()}}; this.maybeCommitted = false; }
    if (this.pending.path !== path || Object.keys(this.pending.body).length !== Object.keys(body).length+1 || Object.entries(body).some(([k,v]) => JSON.stringify(this.pending!.body[k]) !== JSON.stringify(v))) throw new Error('Retry the original request');
    let result: T;
    try { result = await api.post<T>(this.pending.path, this.pending.body); }
    catch (e) {
      if (definiteRejection(e) && !this.maybeCommitted) this.pending = undefined; else this.maybeCommitted = true;
      throw e;
    }
    if (retain?.(result)) this.maybeCommitted = true;
    else this.pending = undefined;
    return result;
  }
  get hasPending(): boolean { return this.pending !== undefined; }
}

