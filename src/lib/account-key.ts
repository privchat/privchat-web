// R7.1 — AccountKey type + derivation helper.
//
// `AccountKey` is the stable, browser-wide identifier for one
// account in this client. It's derived from
// `(gateway_url, user_id)` via SHA-256 / first 16 hex chars; see
// docs/MULTI_ACCOUNT_DESIGN.md for the full rationale.
//
// Rules:
//   - Stable across reconnects, refresh-token rotations, and
//     re-authentications. `(url, user_id)` doesn't change for the
//     life of a session — the access token does.
//   - Unique across gateways: two users with the same `user_id`
//     on different servers hash to different keys.
//   - Filename-safe and log-safe (lowercase hex), so it can
//     suffix Dexie DB names and localStorage keys without
//     escaping.
//   - 64 bits is collision-safe in the small-N regime we care
//     about (a single browser tab will only ever know a handful
//     of accounts).
//
// This module only DERIVES the key. R7.2 wires the result into
// IDB and localStorage namespacing; R7.3+ exposes account-switch
// UI. R7.1 just lands the type + helper.

/** Opaque branded string, 16 lowercase-hex chars (64 bits of
 *  SHA-256 of `${gateway_url}|${user_id}`). Use the
 *  `accountKeyFor` helper to construct one — never a string
 *  literal. */
export type AccountKey = string & { readonly __accountKeyBrand: unique symbol };

/** Derive the AccountKey for `(gateway_url, user_id)`. Async
 *  because SubtleCrypto.digest is async; called once at login,
 *  not on every render. */
export async function accountKeyFor(
  gatewayUrl: string,
  userId: string,
): Promise<AccountKey> {
  const input = `${gatewayUrl}|${userId}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.substring(0, 16) as AccountKey;
}

/** Sentinel used by R7.1 seam-only consumers (scroll-positions,
 *  uploads-store, etc.) when no real account context has been set
 *  yet — i.e. the registry-of-one path the app is on today.
 *  R7.2's migration replaces this with a derived `AccountKey`.
 *
 *  Lives here so all consumers agree on the same string and we
 *  can swap it out in one place during the migration. */
export const LEGACY_DEFAULT_ACCOUNT_KEY = 'legacy-default' as AccountKey;
