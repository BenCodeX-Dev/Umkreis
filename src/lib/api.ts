import { isCategoryId } from '../../shared/categories.ts';
import { isValidPoint } from '../../shared/geo.ts';
import { DEFAULT_TILES, parseTileTemplate, type MapTiles } from '../../shared/mapTiles.ts';
import { safeHttpUrl } from '../../shared/text.ts';
import type { EventItem, EventRights, EventsRequest, EventsResponse, GeocodeResponse, GeocodeResult, SourceMode, SourceStatus } from '../../shared/types.ts';

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Drops anything that does not look like a valid event instead of rendering broken cards. */
function sanitizeRights(raw: unknown): EventRights | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const licenseUrl = safeHttpUrl(r.licenseUrl);
  if (!isStr(r.license) || !r.license.trim() || r.license.length > 40 || !licenseUrl) return undefined;
  return {
    license: r.license,
    licenseUrl,
    by: isStr(r.by) && r.by.trim() ? r.by.slice(0, 120) : undefined,
    shareAlike: r.shareAlike === true || undefined,
  };
}

export function sanitizeEvent(raw: unknown): EventItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (!isStr(e.id) || !isStr(e.title) || !e.title.trim() || !isStr(e.start) || Number.isNaN(Date.parse(e.start))) return null;
  if (!isCategoryId(e.category) || !isStr(e.source) || !isStr(e.sourceName)) return null;
  // Invented sample entries from an earlier version (demo mode) may still sit in saved lists: never show them.
  if (e.isDemo === true || e.source === 'demo') return null;
  const opt = (v: unknown) => (isStr(v) && v.trim() ? v : undefined);
  const price = e.price && typeof e.price === 'object' ? (e.price as EventItem['price']) : undefined;
  return {
    id: e.id,
    source: e.source,
    sourceName: e.sourceName,
    title: e.title,
    start: e.start,
    end: isStr(e.end) && !Number.isNaN(Date.parse(e.end)) ? e.end : undefined,
    timeKnown: e.timeKnown === true,
    allDay: e.allDay === true || undefined,
    venue: opt(e.venue),
    area: opt(e.area),
    address: opt(e.address),
    location: isValidPoint(e.location) ? e.location : undefined,
    locationApprox: e.locationApprox === true || undefined,
    locationRejected: e.locationRejected === true || undefined,
    category: e.category,
    price: price && isStr(price.currency) ? price : undefined,
    description: opt(e.description),
    url: safeHttpUrl(e.url),
    urlLabel: opt(e.urlLabel),
    status: e.status === 'cancelled' || e.status === 'postponed' || e.status === 'rescheduled' ? e.status : undefined,
    rights: sanitizeRights(e.rights),
    checkedAt: isStr(e.checkedAt) && !Number.isNaN(Date.parse(e.checkedAt)) ? e.checkedAt : undefined,
  };
}

/**
 * Saved events from storage: keeps every entry that passes `sanitizeEvent`, so one damaged entry – or an invented
 * sample saved under an earlier version – drops out on its own instead of taking the whole list with it.
 */
export function sanitizeSaved(raw: unknown): Record<string, EventItem> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, EventItem> = {};
  for (const v of Object.values(raw)) {
    const e = sanitizeEvent(v);
    if (e) out[e.id] = e;
  }
  return out;
}

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError('Keine Verbindung zum Server. Bitte Internetverbindung prüfen und erneut versuchen.', 'network');
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('Die Antwort des Servers war unvollständig. Bitte später erneut versuchen.', 'malformed');
  }
  if (!res.ok) {
    const d = data as { error?: unknown; code?: unknown };
    throw new ApiError(isStr(d?.error) && d.error ? d.error : `Serverfehler (${res.status}).`, isStr(d?.code) ? d.code : undefined);
  }
  return data;
}

export async function fetchEvents(req: EventsRequest, signal?: AbortSignal): Promise<EventsResponse & { dropped: number }> {
  const data = (await postJson('/api/events', req, signal)) as Record<string, unknown>;
  if (!data || !Array.isArray(data.events)) throw new ApiError('Die Antwort des Servers war unvollständig.', 'malformed');
  const events = data.events.map(sanitizeEvent).filter((e): e is EventItem => e !== null);
  return {
    mode: data.mode === 'unconfigured' ? 'unconfigured' : 'live',
    events,
    sources: Array.isArray(data.sources) ? (data.sources as SourceStatus[]).filter((s) => s && isStr(s.name)) : [],
    truncated: data.truncated === true,
    dropped: data.events.length - events.length,
  };
}

export async function geocodePlace(q: string, signal?: AbortSignal): Promise<GeocodeResponse> {
  const data = (await postJson('/api/geocode', { q }, signal)) as Record<string, unknown>;
  const results = (Array.isArray(data?.results) ? data.results : []).filter(
    (r): r is GeocodeResult => isValidPoint(r) && isStr((r as GeocodeResult).label),
  );
  return { results, fallback: data?.fallback === true };
}

export interface LegalPages {
  impressum?: string;
  privacy?: string;
}

export interface ServerStatus {
  mode: SourceMode;
  sources: Array<{ id: string; name: string; kind: SourceStatus['kind'] }>;
  /** Tile service the operator configured; missing in the answer means OpenStreetMap's public tiles. */
  map: MapTiles;
  legal: LegalPages;
}

const legalText = (v: unknown): string | undefined => (isStr(v) && v.trim() && v.length <= 64_000 ? v : undefined);

export async function fetchStatus(signal?: AbortSignal): Promise<ServerStatus | null> {
  try {
    const res = await fetch('/api/status', { signal });
    if (!res.ok) return null;
    const d = (await res.json()) as Partial<ServerStatus>;
    if ((d.mode !== 'live' && d.mode !== 'unconfigured') || !Array.isArray(d.sources)) return null;
    const m = d.map as Partial<MapTiles> | undefined;
    const map = (m && isStr(m.url) && parseTileTemplate(m.url, isStr(m.attribution) ? m.attribution : undefined)) || DEFAULT_TILES;
    const l = (d.legal ?? {}) as Record<string, unknown>;
    const impressum = legalText(l.impressum);
    const privacy = legalText(l.privacy);
    return {
      mode: d.mode,
      sources: d.sources.filter((s) => s && isStr(s.name) && isStr(s.kind)),
      map,
      legal: { ...(impressum ? { impressum } : {}), ...(privacy ? { privacy } : {}) },
    };
  } catch {
    return null;
  }
}

export interface StreetLevelPicture {
  id: string;
  takenAt?: string;
  producer?: string;
  license: string;
  licenseUrl?: string;
  viewerUrl: string;
  thumbPath: string;
}
export type StreetLevel = { available: true; radiusM: number; picture: StreetLevelPicture } | { available: false; radiusM: number };

/** Asks the server whether Panoramax has street-level pictures near a venue. */
export async function fetchStreetLevel(point: { lat: number; lon: number }, signal?: AbortSignal): Promise<StreetLevel> {
  const d = (await postJson('/api/streetlevel', { lat: point.lat, lon: point.lon }, signal)) as Record<string, unknown>;
  const radiusM = typeof d?.radiusM === 'number' ? d.radiusM : 50;
  const p = d?.picture as Record<string, unknown> | undefined;
  if (d?.available === true && p && isStr(p.id) && isStr(p.viewerUrl) && isStr(p.thumbPath) && isStr(p.license)) {
    const viewerUrl = safeHttpUrl(p.viewerUrl);
    if (viewerUrl && p.thumbPath.startsWith('/api/streetlevel/thumb/')) {
      return {
        available: true,
        radiusM,
        picture: {
          id: p.id,
          takenAt: isStr(p.takenAt) && !Number.isNaN(Date.parse(p.takenAt)) ? p.takenAt : undefined,
          producer: isStr(p.producer) ? p.producer : undefined,
          license: p.license,
          licenseUrl: safeHttpUrl(p.licenseUrl),
          viewerUrl,
          thumbPath: p.thumbPath,
        },
      };
    }
  }
  return { available: false, radiusM };
}
