import type { GeoPoint } from './types.ts';

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roundCoord(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Rounds to 2 decimals (≈1 km). Home locations are never kept more precisely. */
export function coarsen(p: GeoPoint): GeoPoint {
  return { lat: roundCoord(p.lat), lon: roundCoord(p.lon) };
}

export function isValidPoint(p: unknown): p is GeoPoint {
  if (!p || typeof p !== 'object') return false;
  const { lat, lon } = p as Record<string, unknown>;
  return (
    typeof lat === 'number' && typeof lon === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

/** Generous bounding box around Germany (includes border regions). */
export function isInGermanyBounds(p: GeoPoint): boolean {
  return p.lat >= 47.2 && p.lat <= 55.1 && p.lon >= 5.8 && p.lon <= 15.1;
}

export function offsetPoint(p: GeoPoint, eastKm: number, northKm: number): GeoPoint {
  return {
    lat: p.lat + northKm / 111.32,
    lon: p.lon + eastKm / (111.32 * Math.cos(toRad(p.lat))),
  };
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash(p: GeoPoint, precision = 6): string {
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (p.lon >= mid) { ch = (ch << 1) | 1; lonMin = mid; } else { ch <<= 1; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (p.lat >= mid) { ch = (ch << 1) | 1; latMin = mid; } else { ch <<= 1; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}
