// R8.4b — `RequiredActionsProvider` seam.
//
// One interface, two implementations:
//
//   - BUILTIN: returns `[]` synchronously. v1 doesn't activate the gate
//     in BUILTIN (no platform profile, no terms-acceptance, no KYC).
//     Mechanism is preserved for forward compat — flipping it on for
//     BUILTIN is a server-side change only.
//
//   - PLATFORM: HTTP `GET ${baseUrl}/account/required-actions`.
//     baseUrl already contains `/app`, controller is annotated relatively
//     (`@Controller("/account")`), so final URL is single-/app-layer:
//     e.g. `http://localhost:8080/app/account/required-actions`.
//     Wire-defense: `response.data.requiredActions ?? []` (kotlinx may
//     omit empty arrays; client must tolerate field absence).
//
// Errors reuse R8.3a `PlatformError` taxonomy via `postEnvelope`/`getEnvelope`
// equivalents — for R8.4b we add `getEnvelope` since `platform-envelope.ts`
// only had `postEnvelope`.

import type { AccountMode } from './account-mode';
import {
  getConfiguredAccountMode,
  getPlatformBaseUrl,
} from './account-mode';
import { normalizePlatformBaseUrl } from './platform-base-url';
import { getEnvelope, postAuthedEnvelope } from './platform-envelope';
import { PlatformConfigError } from './platform-errors';
import type { RequiredAction } from './required-action';

export interface RequiredActionsProvider {
  readonly mode: AccountMode;
  /** Fetch the authoritative current required-actions list. Empty array
   *  means the user may enter the workspace; non-empty means the
   *  RequiredActionFlow must run (R8.4c). */
  list(): Promise<RequiredAction[]>;

  /** Submit the phone number for `bind_mobile`.
   *
   *  First-time binding inside the registration flow: the server neither sends
   *  nor checks an SMS code, it only rejects duplicates. Changing an already
   *  bound number is a different endpoint that still requires a code. */
  bindMobile(mobile: string): Promise<void>;
}

/** Token resolver callback. Provider calls this on every `list()` so token
 *  refresh / account switch is picked up live without re-instantiating. */
export type AccessTokenProvider = () => string | null | undefined;

interface RequiredActionsResponseData {
  requiredActions?: RequiredAction[];
}

export class BuiltinRequiredActionsProvider implements RequiredActionsProvider {
  readonly mode = 'builtin' as const;

  /** v1 BUILTIN never has required actions. Stays an `async` function
   *  so callers don't branch on sync vs async per mode. */
  async list(): Promise<RequiredAction[]> {
    return [];
  }

  /** BUILTIN never gates, so nothing should ever reach this. */
  async bindMobile(): Promise<void> {
    throw new PlatformConfigError('bind_mobile is not available in builtin mode');
  }
}

export class PlatformRequiredActionsProvider implements RequiredActionsProvider {
  readonly mode = 'platform' as const;
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly getAccessToken: AccessTokenProvider,
  ) {
    this.baseUrl = normalizePlatformBaseUrl(baseUrl);
  }

  async list(): Promise<RequiredAction[]> {
    const token = this.getAccessToken();
    if (typeof token !== 'string' || token === '') {
      throw new PlatformConfigError(
        'PlatformRequiredActionsProvider.list requires an access token',
      );
    }
    const data = await getEnvelope<RequiredActionsResponseData>(
      `${this.baseUrl}/account/required-actions`,
      token,
    );
    // Wire-defense: missing field → []. Server may omit on empty arrays.
    return data?.requiredActions ?? [];
  }

  async bindMobile(mobile: string): Promise<void> {
    const token = this.getAccessToken();
    if (typeof token !== 'string' || token === '') {
      throw new PlatformConfigError(
        'PlatformRequiredActionsProvider.bindMobile requires an access token',
      );
    }
    await postAuthedEnvelope<RequiredActionsResponseData>(
      `${this.baseUrl}/account/bind-mobile`,
      token,
      { mobile },
    );
  }
}

let cachedProvider: RequiredActionsProvider | null = null;

/** Factory. PLATFORM mode requires a `getAccessToken` callback that resolves
 *  the active account's token at each call site. BUILTIN ignores the
 *  callback (the noop impl never reads it). */
export function getRequiredActionsProvider(
  getAccessToken: AccessTokenProvider,
): RequiredActionsProvider {
  if (cachedProvider !== null) return cachedProvider;
  const mode = getConfiguredAccountMode();
  if (mode === 'platform') {
    const baseUrl = getPlatformBaseUrl();
    if (baseUrl === null) {
      throw new PlatformConfigError(
        'VITE_PRIVCHAT_PLATFORM_BASE_URL is required when VITE_PRIVCHAT_ACCOUNT_MODE=platform',
      );
    }
    cachedProvider = new PlatformRequiredActionsProvider(
      baseUrl,
      getAccessToken,
    );
  } else {
    cachedProvider = new BuiltinRequiredActionsProvider();
  }
  return cachedProvider;
}

/** Test-only reset. */
export function __resetRequiredActionsProviderForTests(): void {
  cachedProvider = null;
}
