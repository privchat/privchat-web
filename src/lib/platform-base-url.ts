// R8.3a — `VITE_PRIVCHAT_PLATFORM_BASE_URL` normalization.
//
// Contract (PLATFORM_AUTH_HTTP_CONTRACT.md §1.4):
//   - MUST end in `/app` (the application's route-group prefix)
//   - MUST NOT end in trailing slash
//   - Web client only appends controller-level paths after this
//
// Lenient transforms ARE allowed:
//   - trim whitespace
//   - strip ANY trailing slashes
//
// Strict assertions (throw `PlatformConfigError`):
//   - empty after trim
//   - missing trailing `/app` segment
//
// Auto-appending `/app` on a deploy that forgot it would silently
// hide a misconfiguration — fail loud instead.

import { PlatformConfigError } from './platform-errors';

export function normalizePlatformBaseUrl(input: string): string {
  if (typeof input !== 'string') {
    throw new PlatformConfigError(
      `platformBaseUrl must be a string (got ${typeof input})`,
    );
  }
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new PlatformConfigError('platformBaseUrl is empty');
  }
  const stripped = trimmed.replace(/\/+$/, '');
  if (!/\/app$/.test(stripped)) {
    throw new PlatformConfigError(
      `platformBaseUrl must end with "/app" (got "${input}"); ` +
        'set VITE_PRIVCHAT_PLATFORM_BASE_URL to include the ' +
        '"/app" route-group prefix',
    );
  }
  return stripped;
}
