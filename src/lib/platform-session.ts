import { loadSession } from './session-storage';
import { normalizePlatformBaseUrl } from './platform-base-url';
import { PlatformConfigError } from './platform-errors';

/** Resolve the active PLATFORM session's base URL + access token (for authed
 *  HTTP calls). Throws when the active account isn't a platform account.
 *  Mirrors privchat-h5's platform-session.ts. */
export function activePlatform(): { baseUrl: string; token: string } {
  const s = loadSession();
  if (s === null || s.account_mode !== 'platform') {
    throw new PlatformConfigError('active account is not a platform account');
  }
  if (s.platform_base_url === undefined || s.platform_base_url === '') {
    throw new PlatformConfigError('platform base url missing from session');
  }
  if (s.access_token === '') {
    throw new PlatformConfigError('access token missing from session');
  }
  return { baseUrl: normalizePlatformBaseUrl(s.platform_base_url), token: s.access_token };
}
