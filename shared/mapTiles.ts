/**
 * OpenStreetMap's public tile server. Fine for personal use; its usage policy
 * (https://operations.osmfoundation.org/policies/tiles/) rules out heavy traffic, so a busy public
 * site sets MAP_TILE_URL to its own or a commercial tile service.
 */
export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export interface MapTiles {
  /** Leaflet URL template with {z}, {x} and {y}; https only. */
  url: string;
  /** Shown to users before the map loads, and the only extra image origin the CSP allows. */
  host: string;
  /** Plain-text credit the tile service requires. Missing means the default OpenStreetMap credit. */
  attribution?: string;
}

/**
 * Accepts only https templates that contain each of {z}, {x}, {y} exactly once, no other braces,
 * quotes, spaces or credentials – the host ends up in the Content-Security-Policy header.
 */
export function parseTileTemplate(raw: string, attribution?: string): MapTiles | null {
  const url = raw.trim();
  if (url.length > 500) return null;
  for (const p of ['{z}', '{x}', '{y}']) if (url.split(p).length !== 2) return null;
  if (/[{}\s"'<>\\;,]/.test(url.replace(/\{[zxy]\}/g, ''))) return null;
  let u: URL;
  try {
    u = new URL(url.replace(/\{[zxy]\}/g, '0'));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const credit = attribution?.replace(/\p{Cc}+/gu, ' ').trim().slice(0, 300);
  return { url, host: u.host, ...(credit ? { attribution: credit } : {}) };
}

export const DEFAULT_TILES: MapTiles = { url: DEFAULT_TILE_URL, host: 'tile.openstreetmap.org' };
