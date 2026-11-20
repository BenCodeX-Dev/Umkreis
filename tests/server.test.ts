import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { distanceKm } from '../shared/geo.ts';
import type { EventItem } from '../shared/types.ts';
import { createApiHandler, parseEventsRequest } from '../server/api.ts';
import { createEventService, MAX_EVENTS } from '../server/events.ts';
import { parseNominatim } from '../server/geocode.ts';
import { createDemoProvider } from '../server/providers/demo.ts';
import { ProviderError, type EventProvider, type ProviderQuery } from '../server/providers/types.ts';

const NOW = new Date('2026-11-20T10:00:00Z');
const FROM = '2026-11-19T23:00:00.000Z';
const TO = '2026-11-21T23:00:00.000Z';

describe('parseEventsRequest', () => {
  it('coarsens coordinates and defaults/clamps the radius', () => {
    const r = parseEventsRequest({ scope: 'local', lat: 49.873456, lon: 8.651234, from: FROM, to: TO }, NOW);
    expect(r.ok && r.value.center).toEqual({ lat: 49.87, lon: 8.65 });
    expect(r.ok && r.value.radiusKm).toBe(15);
    const big = parseEventsRequest({ scope: 'local', lat: 49.87, lon: 8.65, radiusKm: 500, from: FROM, to: TO }, NOW);
    expect(big.ok && big.value.radiusKm).toBe(50);
  });

  it('rejects invalid requests with German messages', () => {
    const cases: unknown[] = [
      { scope: 'local', from: FROM, to: TO },
      { scope: 'local', lat: 48.86, lon: 2.35, from: FROM, to: TO },
      { scope: 'de', from: FROM, to: '2027-01-30T00:00:00.000Z' },
      { scope: 'mars', from: FROM, to: TO },
      { scope: 'de', from: TO, to: FROM },
      null,
    ];
    for (const c of cases) {
      const r = parseEventsRequest(c, NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/[a-zäöü]/);
    }
  });

  it('keeps a trimmed, bounded search text', () => {
    const r = parseEventsRequest({ scope: 'de', from: FROM, to: TO, q: `  ${'x'.repeat(200)} ` }, NOW);
    expect(r.ok && r.value.text?.length).toBe(80);
  });
});

const item = (over: Partial<EventItem>): EventItem => ({
  id: 'p:1', source: 'p', sourceName: 'P', isDemo: false, title: 'Konzert', start: '2026-11-20T18:00:00.000Z', timeKnown: true, category: 'konzert', ...over,
});
const provider = (id: string, impl: (q: ProviderQuery) => Promise<{ events: EventItem[]; truncated?: boolean }>): EventProvider => ({
  id, name: id.toUpperCase(), kind: 'ics', fetchEvents: impl,
});
const query: ProviderQuery = { scope: 'local', center: { lat: 49.87, lon: 8.65 }, radiusKm: 15, from: new Date(FROM), to: new Date(TO) };

describe('event aggregation', () => {
  it('filters by window and radius, drops unlocated events in radius queries, de-duplicates and sorts', async () => {
    const collect = createEventService([
      provider('a', async () => ({
        events: [
          item({ id: 'a:2', title: 'Später', start: '2026-11-21T18:00:00.000Z', location: { lat: 49.88, lon: 8.66 } }),
          item({ id: 'a:1', title: 'Früher', location: { lat: 49.87, lon: 8.65 } }),
          item({ id: 'a:far', title: 'Weit weg', location: { lat: 52.52, lon: 13.4 } }),
          item({ id: 'a:none', title: 'Ohne Ort' }),
          item({ id: 'a:old', title: 'Vorbei', start: '2026-11-10T18:00:00.000Z', location: { lat: 49.87, lon: 8.65 } }),
        ],
      })),
      provider('b', async () => ({ events: [item({ id: 'b:1', title: 'früher!', location: { lat: 49.87, lon: 8.65 } })] })),
    ], 'live');
    const r = await collect(query);
    expect(r.events.map((e) => e.id)).toEqual(['a:1', 'a:2']);
    expect(r.sources.map((s) => [s.id, s.ok, s.count])).toEqual([['a', true, 2], ['b', true, 0]]);
    expect(r.allFailed).toBe(false);
  });

  it('tolerates partial failure and only shows safe error messages', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const collect = createEventService([
      provider('ok', async () => ({ events: [item({ location: { lat: 49.87, lon: 8.65 } })] })),
      provider('bad', async () => { throw new ProviderError('Feed nicht erreichbar.'); }),
      provider('boom', async () => { throw new Error('ECONNRESET secret-host:1234'); }),
    ], 'live');
    const r = await collect(query);
    expect(r.events).toHaveLength(1);
    expect(r.sources.find((s) => s.id === 'bad')?.message).toBe('Feed nicht erreichbar.');
    expect(r.sources.find((s) => s.id === 'boom')?.message).not.toMatch(/secret/);
    spy.mockRestore();
  });

  it('reports when every source failed and truncates large result sets', async () => {
    const failing = createEventService([provider('x', async () => { throw new ProviderError('weg'); })], 'live');
    expect((await failing(query)).allFailed).toBe(true);
    const many = Array.from({ length: MAX_EVENTS + 20 }, (_, i) => item({ id: `m:${i}`, title: `Termin ${i}`, location: { lat: 49.87, lon: 8.65 } }));
    const r = await createEventService([provider('m', async () => ({ events: many }))], 'live')(query);
    expect(r.events).toHaveLength(MAX_EVENTS);
    expect(r.truncated).toBe(true);
  });
});

describe('demo provider', () => {
  it('labels every sample clearly and never links to a fake listing', async () => {
    const collect = createEventService([createDemoProvider(() => NOW)], 'demo');
    const r = await collect(query);
    expect(r.events.length).toBeGreaterThan(0);
    for (const e of r.events) {
      expect(e.isDemo).toBe(true);
      expect(e.url).toBeUndefined();
      expect(e.venue).toMatch(/\(Beispiel\)/);
      expect(distanceKm(query.center!, e.location!)).toBeLessThanOrEqual(15);
    }
  });
});

describe('parseNominatim', () => {
  it('builds coarse German labels and ignores places abroad', () => {
    const out = parseNominatim([
      { lat: '49.8728', lon: '8.6512', address: { city: 'Darmstadt', suburb: 'Bessungen', state: 'Hessen' } },
      { lat: '49.8728', lon: '8.6512', address: { city: 'Darmstadt', suburb: 'Bessungen', state: 'Hessen' } },
      { lat: '48.8566', lon: '2.3522', address: { city: 'Paris' } },
      { lat: 'x', lon: '1' },
    ]);
    expect(out).toEqual([{ label: 'Darmstadt-Bessungen, Hessen', lat: 49.87, lon: 8.65 }]);
    expect(parseNominatim({})).toEqual([]);
  });
});

describe('API handler (demo config)', () => {
  let server: Server;
  let base = '';
  const fakeFetch = vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }));

  beforeAll(async () => {
    const handle = createApiHandler(
      { feeds: [], demoMode: 'auto', geocoderUrl: 'https://nominatim.invalid/search', geocoderUserAgent: 'test', warnings: [] },
      fakeFetch as unknown as typeof fetch,
    );
    server = createServer((req, res) => {
      handle(req, res).then((done) => {
        if (!done) res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const post = (path: string, body: unknown, type = 'application/json') =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify(body) });

  it('reports demo mode', async () => {
    const res = await fetch(`${base}/api/status`);
    expect(await res.json()).toEqual({ mode: 'demo', sources: [{ id: 'demo', name: 'Demo-Daten (erfunden)', kind: 'demo' }] });
  });

  it('returns only labelled demo events', async () => {
    const now = new Date();
    const from = new Date(now.getTime() - 3_600_000).toISOString();
    const to = new Date(now.getTime() + 2 * 86_400_000).toISOString();
    const res = await post('/api/events', { scope: 'local', lat: 49.873, lon: 8.651, radiusKm: 15, from, to });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { mode: string; events: EventItem[] };
    expect(body.mode).toBe('demo');
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.every((e: EventItem) => e.isDemo)).toBe(true);
  });

  it('rejects wrong methods, content types and bad input', async () => {
    expect((await fetch(`${base}/api/events`)).status).toBe(405);
    expect((await post('/api/events', {}, 'text/plain')).status).toBe(415);
    expect((await post('/api/events', { scope: 'local' })).status).toBe(400);
    expect((await post('/api/geocode', { q: 'x' })).status).toBe(400);
    expect((await fetch(`${base}/api/nope`, { method: 'POST' })).status).toBe(404);
  });

  it('proxies place search without leaking the query anywhere but the geocoder', async () => {
    const res = await post('/api/geocode', { q: 'Darmstadt' });
    expect(res.status).toBe(200);
    const url = String((fakeFetch.mock.calls.at(-1) as unknown[] | undefined)?.[0]);
    expect(url).toContain('nominatim.invalid');
    expect(url).toContain('countrycodes=de');
  });
});
