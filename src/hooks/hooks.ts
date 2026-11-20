import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../lib/storage.ts';
import { applyThemePref, isThemePref, resolveTheme, subscribeSystemTheme, systemPrefersDark, THEME_KEY, type ThemePref } from '../lib/theme.ts';

/** State mirrored to localStorage (invalid stored values fall back to the initial value). */
export function usePersistentState<T>(key: string, initial: T, isValid: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored(key);
    return isValid(stored) ? stored : initial;
  });
  useEffect(() => writeStored(key, value), [key, value]);
  return [value, setValue] as const;
}

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Current time, refreshed every minute so past events drop out and "today" rolls over. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export type Route = 'nah' | 'deutschland' | 'gemerkt';
const ROUTES: Route[] = ['nah', 'deutschland', 'gemerkt'];

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
  const r = hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(r) ? r : 'nah';
}

/** Short-lived status message for an aria-live region. */
export function useNotice(ms = 4000) {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), ms);
    return () => clearTimeout(t);
  }, [notice, ms]);
  const notify = useCallback((msg: string) => setNotice(msg), []);
  return [notice, notify] as const;
}

export function navigateTo(route: Route): void {
  window.location.hash = `#${route}`;
}

/** Day/night preference (persisted) plus the theme actually shown right now. */
export function useTheme() {
  const [pref, setPref] = usePersistentState<ThemePref>(THEME_KEY, 'auto', isThemePref);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, systemPrefersDark, () => false);
  useEffect(() => applyThemePref(pref), [pref]);
  return { pref, setPref, theme: resolveTheme(pref, systemDark) } as const;
}
