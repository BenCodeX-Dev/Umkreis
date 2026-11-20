import { searchCities } from '../shared/cities.ts';
import { coarsen, isInGermanyBounds } from '../shared/geo.ts';
import type { GeocodeResponse, GeocodeResult } from '../shared/types.ts';
import { TtlCache } from './cache.ts';
import type { FetchFn } from './providers/types.ts';

type Obj = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Maps Nominatim jsonv2 results to locality-level labels (never street addresses) and ~1 km coordinates. */
export function parseNominatim(data: unknown): GeocodeResult[] {
  if (!Array.isArray(data)) return [];
  const out: GeocodeResult[] = [];
  const labels = new Set<string>();
  for (const item of data as Obj[]) {
    const lat = parseFloat(String(item?.lat)), lon = parseFloat(String(item?.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const a = (item.address && typeof item.address === 'object' ? item.address : {}) as Obj;
    const place = s(a.city) ?? s(a.town) ?? s(a.village) ?? s(a.municipality) ?? s(a.county) ?? s(item.name);
    if (!place) continue;
    const district = s(a.city_district) ?? s(a.suburb);
    const label = [district && district !== place ? `${place}-${district}` : place, s(a.state)].filter(Boolean).join(', ');
    const point = coarsen({ lat, lon });
    if (!isInGermanyBounds(point) || labels.has(label)) continue;
    labels.add(label);
    out.push({ label, ...point });
  }
  return out;
}

export function createGeocoder(url: string, userAgent: string, fetchFn: FetchFn = fetch) {
  const cache = new TtlCache<GeocodeResult[]>(24 * 3_600_000, 500);
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;

  // Nominatim policy: at most 1 request per second, no autocomplete, cache results.
  function throttle(): Promise<void> {
    const run = chain.then(async () => {
      const wait = last + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    chain = run.catch(() => undefined);
    return run;
  }

  return async function geocode(query: string): Promise<GeocodeResponse> {
    const key = query.toLowerCase().replace(/\s+/g, ' ').trim();
    const hit = cache.get(key);
    if (hit) return { results: hit, fallback: false };
    try {
      await throttle();
      const params = new URLSearchParams({ q: query, format: 'jsonv2', countrycodes: 'de', addressdetails: '1', limit: '6', 'accept-language': 'de' });
      const res = await fetchFn(`${url}?${params}`, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results = parseNominatim(await res.json());
      cache.set(key, results);
      return { results, fallback: false };
    } catch {
      return { results: searchCities(query), fallback: true };
    }
  };
}
