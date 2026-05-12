// R8.1 — account-mode config helpers.
//
// Mirrors `privchat-app`'s Kotlin `AccountMode` enum — same two
// values, same compile-time selection model. Reading these
// helpers is cheap (string parse + env access); they're meant to
// be called at module load (factories) and inside React render
// (capability hooks).
//
// See docs/PLATFORM_ACCOUNT_MODE_DESIGN.md for the broader
// rationale and the R8 rollout plan.

export type AccountMode = 'builtin' | 'platform';

const VALID_MODES: ReadonlySet<AccountMode> = new Set(['builtin', 'platform']);

/** Read the configured mode from `VITE_PRIVCHAT_ACCOUNT_MODE`.
 *  Defaults to `'builtin'` when the env var is unset. Throws on
 *  any other value — silently falling back to builtin would mask
 *  a deploy misconfiguration that should be loud. */
export function getConfiguredAccountMode(): AccountMode {
  const forced = maybeForcedMode();
  if (forced !== null) return forced;
  const raw = import.meta.env.VITE_PRIVCHAT_ACCOUNT_MODE?.trim();
  if (raw === undefined || raw === '') return 'builtin';
  if (VALID_MODES.has(raw as AccountMode)) {
    return raw as AccountMode;
  }
  throw new Error(
    `Invalid VITE_PRIVCHAT_ACCOUNT_MODE: ${raw}. Expected 'builtin' or 'platform'.`,
  );
}

/** Read the platform base URL. Returns null when unset / blank
 *  (i.e. the build isn't pointed at a platform). Callers in
 *  builtin mode ignore this; platform-mode factories must assert
 *  non-null via `assertAccountModeConfig()`. */
export function getPlatformBaseUrl(): string | null {
  const forced = maybeForcedPlatformBaseUrl();
  if (forced !== null) return forced;
  const value = import.meta.env.VITE_PRIVCHAT_PLATFORM_BASE_URL?.trim();
  return value === undefined || value === '' ? null : value;
}

/** R8.3b — test-only override hooks. Only consulted when the build
 *  was made with `VITE_PRIVCHAT_TEST_MODE=mock`; in production the
 *  branch's condition is false and the rest is dead code (a few
 *  bytes after minification). Tests stash desired values on
 *  `window.__privchatForcedMode` / `window.__privchatForcedPlatformBaseUrl`
 *  via Playwright's `addInitScript` so the override is in place
 *  BEFORE the React tree mounts and `useAccountCapabilities`
 *  memoizes its result. */
function maybeForcedMode(): AccountMode | null {
  if (import.meta.env.VITE_PRIVCHAT_TEST_MODE !== 'mock') return null;
  if (typeof window === 'undefined') return null;
  const v = (window as unknown as { __privchatForcedMode?: unknown })
    .__privchatForcedMode;
  return v === 'builtin' || v === 'platform' ? v : null;
}

function maybeForcedPlatformBaseUrl(): string | null {
  if (import.meta.env.VITE_PRIVCHAT_TEST_MODE !== 'mock') return null;
  if (typeof window === 'undefined') return null;
  const v = (
    window as unknown as { __privchatForcedPlatformBaseUrl?: unknown }
  ).__privchatForcedPlatformBaseUrl;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

/** Validate the (mode, baseUrl) pair. R8.1 ships this helper but
 *  doesn't auto-call it from `main.tsx` — the boot path stays
 *  byte-for-byte the same so existing builtin installs aren't
 *  perturbed. R8.2's regression smoke + R8.3's PLATFORM wiring
 *  call it explicitly. */
export function assertAccountModeConfig(): void {
  const mode = getConfiguredAccountMode();
  if (mode === 'platform' && getPlatformBaseUrl() === null) {
    throw new Error(
      'VITE_PRIVCHAT_PLATFORM_BASE_URL is required when VITE_PRIVCHAT_ACCOUNT_MODE=platform',
    );
  }
}
