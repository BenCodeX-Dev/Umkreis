import type { GeocodeResult } from './types.ts';

/** City centres (rounded to ~1 km) for Germany-wide browsing and as offline place-search fallback. */
export const CITIES: ReadonlyArray<GeocodeResult> = [
  { label: 'Berlin', lat: 52.52, lon: 13.40 },
  { label: 'Hamburg', lat: 53.55, lon: 9.99 },
  { label: 'München', lat: 48.14, lon: 11.58 },
  { label: 'Köln', lat: 50.94, lon: 6.96 },
  { label: 'Frankfurt am Main', lat: 50.11, lon: 8.68 },
  { label: 'Stuttgart', lat: 48.78, lon: 9.18 },
  { label: 'Düsseldorf', lat: 51.23, lon: 6.78 },
  { label: 'Leipzig', lat: 51.34, lon: 12.37 },
  { label: 'Dortmund', lat: 51.51, lon: 7.47 },
  { label: 'Dresden', lat: 51.05, lon: 13.74 },
  { label: 'Hannover', lat: 52.37, lon: 9.74 },
  { label: 'Nürnberg', lat: 49.45, lon: 11.08 },
  { label: 'Bremen', lat: 53.08, lon: 8.80 },
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();

export function searchCities(query: string): GeocodeResult[] {
  const q = norm(query);
  if (q.length < 2) return [];
  return CITIES.filter((c) => norm(c.label).includes(q) || q.includes(norm(c.label)));
}
