import { RpcError } from '@privchat/sdk';
import { RequestTimeoutError, TransportError } from '@msgtrans/client';

// The global PLATFORM catalog is HTTP-only. Keep IM handling local to this editor
// and reuse existing protocol codes and translated copy, never exception messages.
export function groupIntroductionErrorText(error: unknown, t: (key: string) => string): string {
  if (error instanceof RpcError) {
    if (error.response.code === 10004 || error.response.code === 10008) {
      return t('server_error.permission_denied');
    }
    if ([3, 5, 9].includes(error.response.code)) {
      return t('server_error.service_unavailable');
    }
  }
  if (error instanceof TransportError || error instanceof RequestTimeoutError) {
    return t('server_error.service_unavailable');
  }
  return t('groups.settings_save_failed');
}
