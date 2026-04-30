import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'tarskia.theme';
const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)';

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark';

const readStoredTheme = (): ThemePreference => {
  if (typeof window === 'undefined') {
    return 'system';
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

const resolveSystemTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  return window.matchMedia(SYSTEM_LIGHT_QUERY).matches ? 'light' : 'dark';
};

const resolveTheme = (preference: ThemePreference): ResolvedTheme =>
  preference === 'system' ? resolveSystemTheme() : preference;

const applyResolvedTheme = (resolved: ResolvedTheme) => {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
};

/**
 * Reads the persisted theme preference and applies the matching `<html>` class.
 * Call once during app startup (before render) to avoid a flash of the wrong theme.
 *
 * Note: a synchronous inline script in `index.html` performs the same work before
 * any CSS paint; this function keeps state consistent if/when the inline path is
 * unavailable (e.g. during tests).
 */
export const applyStoredThemeOnLoad = () => {
  applyResolvedTheme(resolveTheme(readStoredTheme()));
};

export function useTheme() {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredTheme());

  // Apply the resolved class and persist whenever the preference changes.
  useEffect(() => {
    applyResolvedTheme(resolveTheme(theme));
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore quota / privacy errors
    }
  }, [theme]);

  // While in 'system' mode, re-resolve when the OS theme changes.
  useEffect(() => {
    if (theme !== 'system') {
      return;
    }
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(SYSTEM_LIGHT_QUERY);
    const handleChange = () => applyResolvedTheme(resolveSystemTheme());
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
