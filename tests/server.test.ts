import { createServer, type Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EventItem } from '../shared/types.ts';
import { createApiHandler, parseEventsRequest } from '../server/api.ts';
import { createEventService, MAX_EVENTS } from '../server/events.ts';
import { createGeocoder, MAX_WAITING, parseNominatim } from '../server/geocode.ts';
import { createStreetLevel, isPublicHttpsUrl, parsePanoramaxSearch } from '../server/streetlevel.ts';
import { isPublicIp, publicOnlyFetch, publicOnlyLookup, toFetchResponse } from '../server/publicFetch.ts';
import { clientAddress, createRateLimiter } from '../server/rateLimit.ts';
import { effectiveAllowedHosts, type ServerConfig } from '../server/config.ts';
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
  id: 'p:1', source: 'p', sourceName: 'P', title: 'Konzert', start: '2026-11-20T18:00:00.000Z', timeKnown: true, category: 'konzert', ...over,
});
const provider = (id: string, impl: (q: ProviderQuery) => Promise<{ events: EventItem[]; truncated?: boolean; checkedAt?: string }>): EventProvider => ({
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

  it('does not ask sources that cannot cover the query, and that is no failure', async () => {
    let asked = 0;
    const far = { ...provider('far', async () => (asked++, { events: [] })), covers: () => false };
    const r = await createEventService([far], 'live')(query);
    expect(asked).toBe(0);
    expect(r.sources).toEqual([]);
    expect(r.allFailed).toBe(false);
    const both = await createEventService([far, provider('near', async () => ({ events: [] }))], 'live')(query);
    expect(both.sources.map((s) => s.id)).toEqual(['near']);
  });

  it('stamps events with the download time and keeps same-time listings that name different venues', async () => {
    const here = { lat: 49.87, lon: 8.65 };
    const collect = createEventService([
      provider('a', async () => ({ events: [item({ id: 'a:1', venue: 'Centralstation', location: here })], checkedAt: '2026-11-20T10:00:00.000Z' })),
      provider('b', async () => ({
        events: [
          item({ id: 'b:1', venue: 'Centralstation', location: here }),
          item({ id: 'b:2', venue: 'Staatstheater', location: here }),
          item({ id: 'b:3', location: here }),
        ],
      })),
    ], 'live');
    const r = await collect(query);
    expect(r.events.map((e) => e.id)).toEqual(['a:1', 'b:2']);
    expect(r.events[0].checkedAt).toBe('2026-11-20T10:00:00.000Z');
    expect(r.events[1].checkedAt).toBeUndefined();
    expect(r.sources.find((s) => s.id === 'a')?.checkedAt).toBe('2026-11-20T10:00:00.000Z');
  });

  it('reports when every source failed and truncates large result sets', async () => {
    const failing = createEventService([provider('x', async () => { throw new ProviderError('weg'); })], 'live');
    expect((await failing(query)).allFailed).toBe(true);
    const many = Array.from({ length: MAX_EVENTS + 20 }, (_, i) => item({ id: `m:${i}`, title: `Termin ${i}`, location: { lat: 49.87, lon: 8.65 } }));
    const r = await createEventService([provider('m', async () => ({ events: many }))], 'live')(query);
    expect(r.events).toHaveLength(MAX_EVENTS);
    expect(r.truncated).toBe(true);
  });

  it('asks a source once when identical queries arrive at the same time', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const collect = createEventService([provider('s', async () => { calls++; await gate; return { events: [item({ location: { lat: 49.87, lon: 8.65 } })] }; })], 'live');
    const both = Promise.all([collect(query), collect(query)]);
    release();
    const [a, b] = await both;
    expect(calls).toBe(1);
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
    await collect(query); // now cached
    expect(calls).toBe(1);
  });

  it('lets the next query retry after a failed one', async () => {
    let calls = 0;
    const collect = createEventService([provider('f', async () => { calls++; throw new ProviderError('weg'); })], 'live');
    await collect(query);
    await collect(query);
    expect(calls).toBe(2);
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

describe('API handler (no source configured)', () => {
  let server: Server;
  let base = '';
  const fakeFetch = vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }));

  beforeAll(async () => {
    const handle = createApiHandler(
      { feeds: [], geocoderUrl: 'https://nominatim.invalid/search', geocoderUserAgent: 'test', appUserAgent: 'test', warnings: [] },
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

  it('reports that no source is set up', async () => {
    const res = await fetch(`${base}/api/status`);
    expect(await res.json()).toEqual({
      mode: 'unconfigured',
      sources: [],
      connect: { enabled: false },
      map: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', host: 'tile.openstreetmap.org' },
      legal: {},
    });
  });

  it('returns no events at all instead of invented ones', async () => {
    const now = new Date();
    const from = new Date(now.getTime() - 3_600_000).toISOString();
    const to = new Date(now.getTime() + 2 * 86_400_000).toISOString();
    const res = await post('/api/events', { scope: 'local', lat: 49.873, lon: 8.651, radiusKm: 15, from, to });
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    const body = (await res.json()) as { code: string; events?: EventItem[] };
    expect(body.code).toBe('no_sources');
    expect(body.events).toBeUndefined();
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

  it('answers street-level lookups and refuses unknown thumbnails', async () => {
    const res = await post('/api/streetlevel', { lat: 49.873, lon: 8.651 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provider: 'panoramax', available: false, radiusM: 50 });
    expect((await post('/api/streetlevel', { lat: 48.85, lon: 2.35 })).status).toBe(400);
    expect((await post('/api/streetlevel', { lat: 'x' })).status).toBe(400);
    const thumb = await fetch(`${base}/api/streetlevel/thumb/00000000-0000-0000-0000-000000000000`);
    expect(thumb.status).toBe(404);
  });
});

describe('street-level imagery (Panoramax)', () => {
  const ID = '74b0b23a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
  const feature = (thumb = 'https://panoramax.example.org/derivatives/x/thumb.jpg') => ({
    type: 'FeatureCollection',
    features: [
      {
        id: ID,
        properties: { datetime: '2025-06-01T10:20:00+02:00', 'geovisio:producer': 'mapcomplete', license: 'CC-BY-SA-4.0' },
        assets: { thumb: { href: thumb } },
        links: [{ rel: 'license', href: 'https://spdx.org/licenses/CC-BY-SA-4.0.html' }],
      },
    ],
  });
  const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/geo+json' } });

  it('accepts only public https URLs', () => {
    expect(isPublicHttpsUrl('https://panoramax.example.org/a.jpg')).toBe(true);
    for (const bad of ['http://a.org/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://a.local/x', 'https://u:p@a.org/x', 'https://a.org:8443/x', 'https://[::1]/x', undefined]) {
      expect(isPublicHttpsUrl(bad)).toBe(false);
    }
  });

  it('parses the first picture with attribution and a same-origin thumbnail path', () => {
    const r = parsePanoramaxSearch(feature());
    expect(r?.picture).toEqual({
      id: ID,
      takenAt: '2025-06-01T08:20:00.000Z',
      producer: 'mapcomplete',
      license: 'CC-BY-SA-4.0',
      licenseUrl: 'https://spdx.org/licenses/CC-BY-SA-4.0.html',
      viewerUrl: `https://api.panoramax.xyz/#focus=pic&pic=${ID}`,
      thumbPath: `/api/streetlevel/thumb/${ID}`,
    });
    expect(parsePanoramaxSearch({ features: [] })).toBeNull();
    expect(parsePanoramaxSearch(feature('http://127.0.0.1/x.jpg'))).toBeNull();
    expect(parsePanoramaxSearch({ features: [{ id: '../../etc', assets: { thumb: { href: 'https://a.org/x' } } }] })).toBeNull();
  });

  it('sends only the venue point, caches the answer and reports when nothing is near', async () => {
    const f = vi.fn(async () => json({ features: [] }));
    const sl = createStreetLevel('UmkreisTest/1', f as unknown as typeof fetch);
    const r = await sl.lookup({ lat: 49.8728253, lon: 8.6511929 });
    expect(r).toEqual({ provider: 'panoramax', available: false, radiusM: 50 });
    await sl.lookup({ lat: 49.87282531, lon: 8.65119291 });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.panoramax.xyz/api/search?place_position=8.65119%2C49.87283&place_distance=0-50&limit=1');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('UmkreisTest/1');
    await expect(sl.lookup({ lat: 48.85, lon: 2.35 })).rejects.toThrow('außerhalb Deutschlands');
    await expect(sl.lookup({ lat: 'x' })).rejects.toThrow('Ungültige Position');
  });

  it('serves only thumbnails it found itself, images only, size-capped', async () => {
    const img = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const f = vi.fn(async (url: string) =>
      url.startsWith('https://api.panoramax.xyz/') ? json(feature()) : new Response(img, { headers: { 'Content-Type': 'image/jpeg' } }),
    );
    const sl = createStreetLevel('UmkreisTest/1', f as unknown as typeof fetch, f as unknown as typeof fetch);
    expect(await sl.thumb(ID)).toBeNull(); // not looked up yet
    const r = await sl.lookup({ lat: 49.87, lon: 8.65 });
    expect(r.available).toBe(true);
    const t = await sl.thumb(ID);
    expect(t?.type).toBe('image/jpeg');
    expect([...t!.body]).toEqual([...img]);
    expect((f.mock.calls.at(-1) as unknown as [string, RequestInit])[1].redirect).toBe('error');
    expect(await sl.thumb('not-a-uuid')).toBeNull();

    const big = vi.fn(async (url: string) =>
      url.startsWith('https://api.panoramax.xyz/') ? json(feature()) : new Response(new Uint8Array(700_000), { headers: { 'Content-Type': 'image/jpeg' } }),
    );
    const sl2 = createStreetLevel('UmkreisTest/1', f as unknown as typeof fetch, big as unknown as typeof fetch);
    await sl2.lookup({ lat: 49.87, lon: 8.65 });
    expect(await sl2.thumb(ID)).toBeNull();

    const html = vi.fn(async (url: string) =>
      url.startsWith('https://api.panoramax.xyz/') ? json(feature()) : new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
    );
    const sl3 = createStreetLevel('UmkreisTest/1', f as unknown as typeof fetch, html as unknown as typeof fetch);
    await sl3.lookup({ lat: 49.87, lon: 8.65 });
    expect(await sl3.thumb(ID)).toBeNull();
  });

  it('turns network failures into a readable message', async () => {
    const sl = createStreetLevel('UmkreisTest/1', (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(sl.lookup({ lat: 49.87, lon: 8.65 })).rejects.toThrow('Panoramax ist gerade nicht erreichbar.');
  });
});

describe('public-only fetch for third-party picture URLs', () => {
  it('tells public from private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', 'not-an-ip']) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '141.1.1.1', '2a00:1450:4001::1']) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  it('refuses a hostname that resolves to this machine', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicOnlyLookup('localhost', {}, (e) => resolve(e)));
    expect(err?.code).toBe('ENOTPUBLIC');
    await expect(publicOnlyFetch('https://localhost/a.jpg')).rejects.toMatchObject({ code: 'ENOTPUBLIC' });
    await expect(publicOnlyFetch('http://example.org/a.jpg')).rejects.toThrow('Nur https');
  });
});

describe('abuse limits', () => {
  it('converts only statuses a fetch Response can carry, instead of throwing in a socket callback', async () => {
    const fake = (statusCode: number) =>
      Object.assign(Readable.from([Buffer.from('ok')]), { statusCode, headers: { 'content-type': 'image/jpeg' } }) as unknown as IncomingMessage;
    expect(() => toFetchResponse(fake(999))).toThrow(RangeError);
    expect(() => toFetchResponse(fake(101))).toThrow(RangeError);
    const ok = toFetchResponse(fake(200));
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(await ok.text()).toBe('ok');
  });

  it('rate-limits each client and all clients together', () => {
    let t = 0;
    const take = createRateLimiter({ capacity: 3, refillPerSec: 1 }, { capacity: 5, refillPerSec: 1 }, () => t);
    expect([take('a'), take('a'), take('a')]).toEqual([0, 0, 0]);
    expect(take('a')).toBeGreaterThan(0);
    expect([take('b'), take('b')]).toEqual([0, 0]);
    expect(take('c')).toBeGreaterThan(0); // shared bucket (5) used up
    t += 2000;
    expect(take('a')).toBe(0);
  });

  it('counts clients behind a trusted proxy by the address the proxy reports', () => {
    expect(clientAddress('10.0.0.2', '203.0.113.9', false)).toBe('10.0.0.2');
    expect(clientAddress('10.0.0.2', 'spoofed, 203.0.113.9', true)).toBe('203.0.113.9');
    expect(clientAddress('10.0.0.2', ['a', 'b, 198.51.100.4'], true)).toBe('198.51.100.4');
    expect(clientAddress('10.0.0.2', undefined, true)).toBe('10.0.0.2');
    expect(clientAddress('10.0.0.2', 'x'.repeat(100), true)).toBe('10.0.0.2');
    expect(clientAddress(undefined, undefined, false)).toBe('unbekannt');
  });

  it('answers 429 with Retry-After once a client exceeds its budget', async () => {
    const handle = createApiHandler(
      { feeds: [], geocoderUrl: 'https://nominatim.invalid/search', geocoderUserAgent: 'test', appUserAgent: 'test', warnings: [] },
      (async () => new Response('[]')) as unknown as typeof fetch,
      { client: { capacity: 2, refillPerSec: 0.01 }, shared: { capacity: 100, refillPerSec: 1 } },
    );
    const srv = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const post = () => fetch(`${url}/api/geocode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"q":"Darmstadt"}' });
    try {
      expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(200);
      const limited = await post();
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await fetch(`${url}/api/status`)).status).toBe(200); // status never calls a third party
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it('does not queue unlimited place searches behind the 1-per-second Nominatim limit', async () => {
    const never = vi.fn(() => new Promise<Response>(() => {}));
    const geocode = createGeocoder('https://nominatim.invalid/search', 'test', never as unknown as typeof fetch);
    for (let i = 0; i < MAX_WAITING; i++) void geocode(`Ort ${i}`);
    const overflow = await geocode('Darmstadt');
    expect(overflow.fallback).toBe(true);
    expect(never.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('lets a loopback server answer only to its own host names by default', () => {
    const cfg = { allowedHosts: undefined } as ServerConfig;
    expect(effectiveAllowedHosts(cfg, '127.0.0.1', 8787)).toEqual(['127.0.0.1:8787', 'localhost:8787', '[::1]:8787']);
    expect(effectiveAllowedHosts(cfg, '0.0.0.0', 8787)).toBeUndefined();
    expect(effectiveAllowedHosts({ allowedHosts: ['events.example.org'] } as ServerConfig, '0.0.0.0', 80)).toEqual(['events.example.org']);
  });
});
