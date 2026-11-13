import { test, expect } from '@playwright/test';
import { isSessionExpiredError } from '../../src/lib/platform-error-message';
import { PlatformApiError, PlatformHttpError } from '../../src/lib/platform-errors';

// The retry gate in WorkspaceApi.authed: only an auth rejection (expired /
// revoked access token, or a bare 401) may trigger a refresh. A business
// error or the local "no token" guard must NOT, or we would refresh on
// every conflict / logged-out call.

test('auth rejections classify as session-expired (refresh-worthy)', () => {
  // Backend AUTH_REQUIRED on HTTP 401 — the confirmed expired-token shape.
  expect(isSessionExpiredError(new PlatformApiError(10000, 'AUTH_REQUIRED'))).toBe(true);
  // Bare 401 with a non-envelope body (e.g. gateway) still counts.
  expect(isSessionExpiredError(new PlatformHttpError(401, 'HTTP 401'))).toBe(true);
});

test('non-auth errors never classify as session-expired', () => {
  // Business conflict on HTTP 200 — must surface, not refresh.
  expect(isSessionExpiredError(new PlatformApiError(10200, 'CONFLICT'))).toBe(false);
  // Transport 500 — not an auth failure.
  expect(isSessionExpiredError(new PlatformHttpError(500, 'HTTP 500'))).toBe(false);
  // Local "no active token" guard (code 401, NOT_AUTHENTICATED) — there is
  // no session to refresh, so it must not be treated as refresh-worthy.
  expect(isSessionExpiredError(new PlatformApiError(401, 'NOT_AUTHENTICATED'))).toBe(false);
  expect(isSessionExpiredError(new Error('boom'))).toBe(false);
  expect(isSessionExpiredError(null)).toBe(false);
});