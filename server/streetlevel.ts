import { isInGermanyBounds, isValidPoint, roundCoord } from '../shared/geo.ts';
import type { GeoPoint } from '../shared/types.ts';
import { TtlCache } from './cache.ts';
import { readTextCapped } from './providers/ics.ts';
import type { FetchFn } from './providers/types.ts';

/**
 * Street-level imagery from Panoramax (https://panoramax.fr), a free, federated photo commons
 * from the OpenStreetMap community. It needs no key. Only the venue's position is sent – never
 * the user's – and only when someone asks for imagery of one event.
 */
const SEARCH_URL = 'https://api.panoramax.xyz/api/search';
/** Picture link format documented at https://wiki.openstreetmap.org/wiki/Key:panoramax */
const VIEWER_URL = 'https://api.panoramax.xyz/#focus=pic&pic=';
const SEARCH_RADIUS_M = 50;
const MAX_JSON = 1_000_000;
const MAX_THUMB = 600_000;
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StreetLevelPicture {
  id: string;
  takenAt?: string;
  producer?: string;
  license: string;
  licenseUrl?: string;
  viewerUrl: string;
  /** Same-origin path; the server fetches the image so the page's CSP stays closed to third parties. */
  thumbPath: string;
}

export type StreetLevelResult =
  | { provider: 'panoramax'; available: true; radiusM: number; picture: StreetLevelPicture }
  | { provider: 'panoramax'; available: false; radiusM: number };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Accepts only public https hosts – no IP literals, no localhost. */
export function isPublicHttpsUrl(raw: string | undefined): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const h = u.hostname;
    return h.includes('.') && !/^[\d.]+$/.test(h) && !h.includes(':') && !h.endsWith('.local') && !h.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function parsePanoramaxSearch(data: unknown): { picture: StreetLevelPicture; thumbUrl: string } | null {
  const features = obj(data)?.features;
  const f = obj(Array.isArray(features) ? features[0] : undefined);
  const id = str(f?.id);
  if (!f || !id || !UUID.test(id)) return null;
  const thumbUrl = str(obj(obj(f.assets)?.thumb)?.href);
  if (!isPublicHttpsUrl(thumbUrl)) return null;
  const props = obj(f.properties) ?? {};
  const links = Array.isArray(f.links) ? f.links.map(obj) : [];
  const licenseUrl = str(links.find((l) => l?.rel === 'license')?.href);
  const takenAt = str(props.datetime);
  return {
    thumbUrl,
    picture: {
      id,
      takenAt: takenAt && !Number.isNaN(Date.parse(takenAt)) ? new Date(takenAt).toISOString() : undefined,
      producer: str(props['geovisio:producer'])?.slice(0, 80),
      license: str(props.license)?.slice(0, 40) ?? 'Lizenz siehe Panoramax',
      licenseUrl: isPublicHttpsUrl(licenseUrl) ? licenseUrl : undefined,
      viewerUrl: `${VIEWER_URL}${id}`,
      thumbPath: `/api/streetlevel/thumb/${id}`,
    },
  };
}

export class StreetLevelError extends Error {}

/** Reads at most `limit` bytes; returns null (and cancels the download) when the body is larger. */
async function readBytesCapped(res: Response, limit: number): Promise<Buffer | null> {
  if (Number(res.headers.get('content-length')) > limit) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function createStreetLevel(userAgent: string, fetchFn: FetchFn = fetch) {
  const results = new TtlCache<StreetLevelResult>(DAY_MS, 500);
  const thumbs = new TtlCache<string>(DAY_MS, 500);

  async function lookup(raw: unknown): Promise<StreetLevelResult> {
    if (!isValidPoint(raw)) throw new StreetLevelError('Ungültige Position.');
    // 5 decimals ≈ 1 m: enough for a venue, and identical requests share one cache entry.
    const p: GeoPoint = { lat: roundCoord(raw.lat, 5), lon: roundCoord(raw.lon, 5) };
    if (!isInGermanyBounds(p)) throw new StreetLevelError('Die Position liegt außerhalb Deutschlands.');
    const key = `${p.lat},${p.lon}`;
    const hit = results.get(key);
    if (hit) return hit;

    const params = new URLSearchParams({ place_position: `${p.lon},${p.lat}`, place_distance: `0-${SEARCH_RADIUS_M}`, limit: '1' });
    let res: Response;
    try {
      res = await fetchFn(`${SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/geo+json, application/json', 'User-Agent': userAgent } });
    } catch {
      throw new StreetLevelError('Panoramax ist gerade nicht erreichbar.');
    }
    if (!res.ok) throw new StreetLevelError(`Panoramax antwortet mit Fehler ${res.status}.`);
    let data: unknown;
    try {
      data = JSON.parse(await readTextCapped(res, MAX_JSON));
    } catch {
      throw new StreetLevelError('Panoramax hat eine unlesbare Antwort geliefert.');
    }
    const found = parsePanoramaxSearch(data);
    const result: StreetLevelResult = found
      ? { provider: 'panoramax', available: true, radiusM: SEARCH_RADIUS_M, picture: found.picture }
      : { provider: 'panoramax', available: false, radiusM: SEARCH_RADIUS_M };
    if (found) thumbs.set(found.picture.id, found.thumbUrl);
    results.set(key, result);
    return result;
  }

  /** Only pictures this server found itself can be fetched – the client never supplies a URL. */
  async function thumb(id: string): Promise<{ type: string; body: Buffer } | null> {
    const url = UUID.test(id) ? thumbs.get(id) : undefined;
    if (!url) return null;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(8_000), headers: { Accept: 'image/jpeg, image/webp, image/png', 'User-Agent': userAgent }, redirect: 'error' });
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
      const body = await readBytesCapped(res, MAX_THUMB);
      return body ? { type, body } : null;
    } catch {
      return null;
    }
  }

  return { lookup, thumb };
}
