// React surface for the theme module. Owns:
//   - the user's persisted preference (light/dark/system)
//   - the resolved theme that's currently applied to <html>
//   - live updates when the OS dark-mode setting toggles (only matters
//     when preference === 'system')
//
// The provider applies the theme imperatively (to document.documentElement)
// so it works with Tailwind's class-based dark mode without any per-
// component prop threading.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyTheme,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(loadThemePreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));
  const applied = useRef<ResolvedTheme | null>(null);

  // Apply on every resolved change. Cheap (single classList toggle) so
  // skipping equal values isn't worth a useMemo dance.
  useEffect(() => {
    if (applied.current === resolved) return;
    applyTheme(resolved);
    applied.current = resolved;
  }, [resolved]);

  // Recompute when preference changes (light/dark/system).
  useEffect(() => {
    setResolved(resolveTheme(preference));
  }, [preference]);

  // System theme can change at any time — only listen when the user
  // chose 'system'. Cleanup unsubscribes on preference flip.
  useEffect(() => {
    if (preference !== 'system') return;
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
    setPreferenceState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const v = useContext(ThemeContext);
  if (v === null) throw new Error('useTheme must be called inside <ThemeProvider>');
  return v;
}
