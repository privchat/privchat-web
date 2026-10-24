import type { ConnectionState } from '@privchat/sdk';

/** Retain an existing workspace through transient restoration, not logout/terminal loss. */
export function retainChatWorkspace(state: ConnectionState, userId: string | undefined): boolean {
  return state === 'authenticated' || (!!userId && (
    state === 'reconnecting' || state === 'connecting' ||
    state === 'connected' || state === 'authenticating'
  ));
}
