import { PrivchatClient } from '@privchat/sdk';
import { DirectClientAdapter } from '@privchat/react';

export interface CreatePrivchatOptions {
  url: string;
  /** Dexie DB name. Defaults to "privchat-web-dev". */
  dbName?: string;
}

export interface PrivchatHandle {
  /** Underlying SDK client. The host (this app) drives lifecycle (connect / authenticate / disconnect / dispose). */
  client: PrivchatClient;
  /** React-facing seam: pass to <PrivchatProvider adapter={...}>. */
  adapter: DirectClientAdapter;
}

/**
 * Construct a PrivchatClient + the DirectClientAdapter that wraps it for
 * @privchat/react. Per the architecture contract, lifecycle (connect /
 * authenticate / disconnect / dispose) is the host's responsibility — this
 * factory does NOT call any of those. The caller invokes them via the
 * returned `client` reference, while React reads state through `adapter`.
 */
export function createPrivchat(opts: CreatePrivchatOptions): PrivchatHandle {
  const client = new PrivchatClient({
    url: opts.url,
    cache: { enabled: true, dbName: opts.dbName ?? 'privchat-web-dev' },
  });
  const adapter = new DirectClientAdapter(client);
  return { client, adapter };
}
