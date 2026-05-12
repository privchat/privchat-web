// R8.1 — capability gate.
//
// UI code MUST NOT branch on `mode === 'platform'` directly.
// Every feature that's mode-conditional reads from a single
// `AccountCapabilities` shape, populated from one of two static
// constants. This means:
//
//   - adding a new mode (OIDC, etc.) is a one-place change
//   - the BUILTIN-only build doesn't even render code paths that
//     would call into platform-only HTTP endpoints
//   - tests can assert on the matrix exactly once and be done
//
// The hook returns the matrix synchronously based on the
// compile-time mode; there's no async resolution. R8.4+ may
// extend the shape (e.g. `videoCalls`, `voiceRecording`); the
// constants pattern keeps that diff small.

import { useMemo } from 'react';
import {
  getConfiguredAccountMode,
  type AccountMode,
} from './account-mode';

export interface AccountCapabilities {
  /** Edit nickname / bio / gender / birthday. */
  profileEdit: boolean;
  /** Upload + change avatar image. */
  avatarUpload: boolean;
  /** Login via SMS code (mobile + verification code). */
  smsLogin: boolean;
  /** Login via QR scanned by an already-authed mobile App. */
  qrLogin: boolean;
  /** Username + password login. Always true today; the field
   *  exists so a future "QR-only" deployment can flip it off. */
  passwordLogin: boolean;
}

export const BUILTIN_CAPABILITIES: AccountCapabilities = {
  profileEdit: false,
  avatarUpload: false,
  smsLogin: false,
  qrLogin: false,
  passwordLogin: true,
};

export const PLATFORM_CAPABILITIES: AccountCapabilities = {
  profileEdit: true,
  avatarUpload: true,
  smsLogin: true,
  qrLogin: true,
  passwordLogin: true,
};

export function capabilitiesFor(mode: AccountMode): AccountCapabilities {
  return mode === 'platform' ? PLATFORM_CAPABILITIES : BUILTIN_CAPABILITIES;
}

/** React hook variant. Stable identity per render — both
 *  constants are module-frozen, so `useMemo` is just for
 *  reference equality across consumers. */
export function useAccountCapabilities(): AccountCapabilities {
  return useMemo(() => capabilitiesFor(getConfiguredAccountMode()), []);
}
