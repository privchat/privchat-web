// Stable, persisted Web device identity.
//
// The IM token is bound to device_id, and the server treats a never-seen
// (user_id, device_id) pair as a brand-new device login -> it posts a
// "您的账号在 ... 设备登录了" system message. Previously the Web client
// generated a fresh random device_id on every login/page-load, so every
// reload looked like a new device and spammed login notifications.
//
// Persist one device_id in localStorage and reuse it forever (until the
// user explicitly clears this device). Native apps already do this via the
// platform vendor id; this brings Web to parity.

const DEVICE_ID_KEY = 'privchat.web.device_id';

/** The device id every PrivChat / Weey client and server uses: a random UUID v4, lowercase, hyphenated. */
const CANONICAL_DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isCanonicalDeviceId(id: string): boolean {
  return CANONICAL_DEVICE_ID.test(id);
}

/** A secure random v4; `getRandomValues` exists even where `randomUUID` does not (non-secure contexts). */
export function newDeviceId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Returns the persisted Web device_id, creating and storing one on first use.
 * Reused across page reloads, reconnects and token refresh so the server
 * recognizes the same device and does not re-notify a "new device login".
 * A stored value in any other form is a corrupt store and fails loudly.
 */
export function getOrCreateDeviceId(): string {
  const storage = window.localStorage;
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing != null) {
    if (!isCanonicalDeviceId(existing)) throw new Error('The stored device id is not a canonical UUID v4');
    return existing;
  }
  const id = newDeviceId();
  storage.setItem(DEVICE_ID_KEY, id);
  return id;
}

/** Clear the persisted device id (e.g. user chose "forget this device"). */
export function clearDeviceId(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(DEVICE_ID_KEY);
  }
}
