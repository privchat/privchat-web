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

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback for older browsers / non-secure contexts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns the persisted Web device_id, creating and storing one on first use.
 * Reused across page reloads, reconnects and token refresh so the server
 * recognizes the same device and does not re-notify a "new device login".
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    // SSR / storage unavailable: best-effort fresh id (cannot persist).
    return generateUuid();
  }
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing != null && existing.length > 0) {
    return existing;
  }
  const id = generateUuid();
  window.localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

/** Clear the persisted device id (e.g. user chose "forget this device"). */
export function clearDeviceId(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(DEVICE_ID_KEY);
  }
}
