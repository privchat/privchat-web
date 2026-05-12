import type { ReactNode } from 'react';
import { PrivchatProvider } from '@privchat/react';
import type { PrivchatHandle } from '@/lib/privchat-client';

export interface AppProvidersProps {
  handle: PrivchatHandle | null;
  /** R7.3 — key on the active `AccountKey` so a switch unmounts
   *  and remounts the entire React subtree under the provider.
   *  Without this, switching from account A to account B would
   *  reuse every hook subscription / scroll position / virtualizer
   *  instance under the still-mounted ChatWorkspace, leaking A's
   *  in-memory state into B's render. */
  providerKey?: string | null;
  children: ReactNode;
}

/**
 * Single composition point for app-wide providers. Currently only wraps the
 * tree with <PrivchatProvider> when a handle has been constructed. If `handle`
 * is null we render children directly so that the Login page (which does NOT
 * call usePrivchatClient) can still mount.
 */
export function AppProviders({
  handle,
  providerKey,
  children,
}: AppProvidersProps) {
  if (handle === null) return <>{children}</>;
  return (
    <PrivchatProvider
      key={providerKey ?? undefined}
      adapter={handle.adapter}
    >
      {children}
    </PrivchatProvider>
  );
}
