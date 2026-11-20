import { isCategoryId } from '../../shared/categories.ts';
import { isValidPoint } from '../../shared/geo.ts';
import { safeHttpUrl } from '../../shared/text.ts';
import type { EventItem, EventsRequest, EventsResponse, GeocodeResponse, GeocodeResult, SourceStatus } from '../../shared/types.ts';

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Drops anything that does not look like a valid event instead of rendering broken cards. */
export function sanitizeEvent(raw: unknown): EventItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (!isStr(e.id) || !isStr(e.title) || !e.title.trim() || !isStr(e.start) || Number.isNaN(Date.parse(e.start))) return null;
  if (!isCategoryId(e.category) || typeof e.isDemo !== 'boolean' || !isStr(e.source) || !isStr(e.sourceName)) return null;
  const opt = (v: unknown) => (isStr(v) && v.trim() ? v : undefined);
  const price = e.price && typeof e.price === 'object' ? (e.price as EventItem['price']) : undefined;
  return {
    id: e.id,
    source: e.source,
    sourceName: e.sourceName,
    isDemo: e.isDemo,
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
    category: e.category,
    price: price && isStr(price.currency) ? price : undefined,
    description: opt(e.description),
    url: safeHttpUrl(e.url),
    urlLabel: opt(e.urlLabel),
    status: e.status === 'cancelled' || e.status === 'postponed' || e.status === 'rescheduled' ? e.status : undefined,
  };
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
    mode: data.mode === 'demo' ? 'demo' : 'live',
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

export interface ServerStatus {
  mode: 'live' | 'demo';
  sources: Array<{ id: string; name: string; kind: SourceStatus['kind'] }>;
}

export async function fetchStatus(signal?: AbortSignal): Promise<ServerStatus | null> {
  try {
    const res = await fetch('/api/status', { signal });
    if (!res.ok) return null;
    const d = (await res.json()) as Partial<ServerStatus>;
    if ((d.mode !== 'live' && d.mode !== 'demo') || !Array.isArray(d.sources)) return null;
    return { mode: d.mode, sources: d.sources.filter((s) => s && isStr(s.name) && isStr(s.kind)) };
  } catch {
    return null;
  }
}
