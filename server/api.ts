import type { IncomingMessage, ServerResponse } from 'node:http';
import { coarsen, isInGermanyBounds } from '../shared/geo.ts';
import { buildProviders, type ServerConfig } from './config.ts';
import { createEventService } from './events.ts';
import { createGeocoder } from './geocode.ts';
import { createStreetLevel, StreetLevelError } from './streetlevel.ts';
import type { FetchFn, ProviderQuery } from './providers/types.ts';

const DAY_MS = 86_400_000;
const MAX_BODY = 4096;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validates an events request. Coordinates travel in the POST body (never in URLs or logs)
 * and are rounded to ~1 km again here as a safeguard.
 */
export function parseEventsRequest(body: unknown, now = new Date()): Parsed<ProviderQuery> {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const scope = b.scope === 'de' ? 'de' : b.scope === 'local' ? 'local' : null;
  if (!scope) return { ok: false, error: 'Ungültiger Bereich.' };
  const from = new Date(typeof b.from === 'string' ? b.from : NaN);
  const to = new Date(typeof b.to === 'string' ? b.to : NaN);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return { ok: false, error: 'Ungültiger Zeitraum.' };
  if (to.getTime() - from.getTime() > 31 * DAY_MS || from.getTime() < now.getTime() - 2 * DAY_MS || to.getTime() > now.getTime() + 62 * DAY_MS) {
    return { ok: false, error: 'Der Zeitraum ist zu lang oder liegt außerhalb des unterstützten Bereichs.' };
  }

  const q: ProviderQuery = { scope, from, to };
  const hasPoint = typeof b.lat === 'number' && typeof b.lon === 'number' && Number.isFinite(b.lat) && Number.isFinite(b.lon);
  if (hasPoint) {
    const center = coarsen({ lat: b.lat as number, lon: b.lon as number });
    if (!isInGermanyBounds(center)) return { ok: false, error: 'Der Standort liegt außerhalb Deutschlands.' };
    q.center = center;
    const r = typeof b.radiusKm === 'number' && Number.isFinite(b.radiusKm) ? b.radiusKm : 15;
    q.radiusKm = Math.min(50, Math.max(1, Math.round(r)));
  } else if (scope === 'local') {
    return { ok: false, error: 'Für die Umgebungssuche wird ein Ort benötigt.' };
  }
  if (typeof b.q === 'string' && b.q.trim()) q.text = b.q.trim().slice(0, 80);
  return { ok: true, value: q };
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** Returns a handler that answers /api/* requests and resolves to false for anything else. */
export function createApiHandler(cfg: ServerConfig, fetchFn: FetchFn = fetch) {
  const { providers, mode } = buildProviders(cfg, fetchFn);
  const collect = createEventService(providers, mode);
  const geocode = createGeocoder(cfg.geocoderUrl, cfg.geocoderUserAgent, fetchFn);
  const streetLevel = createStreetLevel(cfg.appUserAgent, fetchFn);

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!pathname.startsWith('/api/')) return false;

    if (pathname === '/api/status' && req.method === 'GET') {
      send(res, 200, { mode, sources: providers.map((p) => ({ id: p.id, name: p.name, kind: p.kind })) });
      return true;
    }
    const thumbId = /^\/api\/streetlevel\/thumb\/([0-9a-f-]{36})$/i.exec(pathname)?.[1];
    if (thumbId && req.method === 'GET') {
      const img = await streetLevel.thumb(thumbId);
      if (!img) {
        send(res, 404, { error: 'Bild nicht verfügbar.' });
        return true;
      }
      res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      res.end(img.body);
      return true;
    }
    if (pathname !== '/api/events' && pathname !== '/api/geocode' && pathname !== '/api/streetlevel') {
      send(res, 404, { error: 'Nicht gefunden.' });
      return true;
    }
    if (req.method !== 'POST') {
      send(res, 405, { error: 'Methode nicht erlaubt.' });
      return true;
    }
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      send(res, 415, { error: 'JSON erwartet.' });
      return true;
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      send(res, 400, { error: 'Ungültige Anfrage.' });
      return true;
    }

    if (pathname === '/api/streetlevel') {
      try {
        send(res, 200, await streetLevel.lookup(body));
      } catch (err) {
        if (!(err instanceof StreetLevelError)) throw err;
        send(res, /Ungültig|außerhalb/.test(err.message) ? 400 : 502, { error: err.message });
      }
      return true;
    }

    if (pathname === '/api/geocode') {
      const query = typeof (body as { q?: unknown })?.q === 'string' ? (body as { q: string }).q.trim() : '';
      if (query.length < 2 || query.length > 100) {
        send(res, 400, { error: 'Bitte einen Ort oder eine Postleitzahl eingeben (2–100 Zeichen).' });
        return true;
      }
      send(res, 200, await geocode(query));
      return true;
    }

    if (providers.length === 0) {
      send(res, 503, { error: 'Es ist keine Veranstaltungsquelle eingerichtet. Siehe README: Ticketmaster-Schlüssel oder iCal-Feeds konfigurieren.', code: 'no_sources' });
      return true;
    }
    const parsed = parseEventsRequest(body);
    if (!parsed.ok) {
      send(res, 400, { error: parsed.error });
      return true;
    }
    const result = await collect(parsed.value);
    if (result.allFailed) {
      send(res, 502, { error: result.sources.map((s) => s.message).filter(Boolean).join(' '), code: 'sources_failed' });
      return true;
    }
    const { allFailed: _ignored, ...payload } = result;
    void _ignored;
    send(res, 200, payload);
    return true;
  };
}
