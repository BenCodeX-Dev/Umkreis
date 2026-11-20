import { readStored } from './storage.ts';

/** 'auto' follows the operating system; 'day' and 'night' are an explicit choice. */
export type ThemePref = 'auto' | 'day' | 'night';
export type Theme = 'day' | 'night';

export const THEME_KEY = 'umkreis.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export const isThemePref = (v: unknown): v is ThemePref => v === 'auto' || v === 'day' || v === 'night';

export function loadThemePref(): ThemePref {
  const v = readStored(THEME_KEY);
  return isThemePref(v) ? v : 'auto';
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref !== 'auto') return pref;
  return systemDark ? 'night' : 'day';
}

/** Sets or clears `<html data-theme>`; without it the stylesheet follows the system setting. */
export function applyThemePref(pref: ThemePref, root: { dataset: DOMStringMap } = document.documentElement): void {
  if (pref === 'auto') delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function subscribeSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
