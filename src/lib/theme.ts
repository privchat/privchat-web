// Theme: persisted preference (`light` | `dark` | `system`).
// `system` means the resolved theme follows `prefers-color-scheme` and
// updates live when the OS toggles.

const STORAGE_KEY = 'privchat.web.theme';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const VALID = new Set<ThemePreference>(['light', 'dark', 'system']);

export function loadThemePreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null && VALID.has(raw as ThemePreference)) return raw as ThemePreference;
  } catch {
    /* localStorage unavailable */
  }
  return 'system';
}

export function saveThemePreference(value: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* localStorage unavailable / quota — silently fall back to ephemeral */
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Apply the resolved theme to <html> by toggling the `dark` class. */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  // Hint the UA so native form controls / scrollbars match.
  root.style.colorScheme = resolved;
}
