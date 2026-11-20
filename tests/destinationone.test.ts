import { describe, expect, it } from 'vitest';
import {
  createDestinationOneProvider,
  destinationOneUrl,
  matchesDay,
  normalizeDestinationOneEvent,
  parseInterval,
  type Budget,
} from '../server/providers/destinationone.ts';
import { ProviderError, type ProviderQuery } from '../server/providers/types.ts';

// Synthetic records shaped like the destination.one "open-data" ET2014A.json response.
const record = (over: Record<string, unknown> = {}) => ({
  id: '100000001',
  global_id: 'e_100000001',
  title: ' Wochenmarkt Musterstadt',
  name: 'Marktplatz',
  street: 'Marktplatz 1',
  zip: '64283',
  city: 'Musterstadt',
  country: 'Deutschland',
  geo: { main: { latitude: 49.87, longitude: 8.65 } },
  categories: ['ZG Städte-Genießer (O)', 'Veranstaltung', 'Wochenmarkt'],
  attributes: [{ key: 'license', value: 'PD' }],
  texts: [
    { rel: 'teaser', type: 'text/plain', value: 'Kurz' },
    { rel: 'details', type: 'text/html', value: '<p>Frisches <b>Obst</b></p>' },
    { rel: 'details', type: 'text/plain', value: 'Frisches Obst und Gemüse' },
  ],
  web: 'https://www.example.org/markt',
  media_objects: [{ rel: 'PRICE_KARTENLINK', url: 'https://tickets.example.org/' }],
  timeIntervals: [
    { weekdays: ['Thursday'], start: '2026-08-06T08:30:00+02:00', end: '2026-08-06T13:00:00+02:00', tz: 'Europe/Berlin', freq: 'Weekly', interval: 1 },
  ],
  ...over,
});

// Window: Mon 2026-11-23 00:00 to Mon 2026-12-07 00:00 Berlin time.
const from = new Date('2026-11-22T23:00:00Z');
const to = new Date('2026-12-06T23:00:00Z');

describe('destination.one recurrence', () => {
  it('expands an open-ended weekly market into each Thursday of the window', () => {
    const items = normalizeDestinationOneEvent(record(), from, to);
    expect(items.map((e) => e.start)).toEqual(['2026-11-26T07:30:00.000Z', '2026-12-03T07:30:00.000Z']);
    expect(items[0].end).toBe('2026-11-26T12:00:00.000Z');
    expect(items[0].timeKnown).toBe(true);
    expect(new Set(items.map((e) => e.id)).size).toBe(2);
  });

  it('honours interval, repeatUntil and repeatCount', () => {
    const biweekly = { ...record().timeIntervals[0], interval: 2 };
    expect(normalizeDestinationOneEvent(record({ timeIntervals: [biweekly] }), from, to)).toHaveLength(1);
    const until = { ...record().timeIntervals[0], repeatUntil: '2026-11-30T13:00:00+01:00' };
    expect(normalizeDestinationOneEvent(record({ timeIntervals: [until] }), from, to)).toHaveLength(1);
    const daily = { weekdays: [], start: '2026-11-20T10:00:00+01:00', end: '2026-11-20T18:00:00+01:00', tz: 'Europe/Berlin', freq: 'Daily', interval: 1, repeatCount: 5 };
    // 20., 21., 22. are before the window; 23. and 24. are the 4th and 5th sitting.
    expect(normalizeDestinationOneEvent(record({ timeIntervals: [daily] }), from, to).map((e) => e.start.slice(0, 10))).toEqual(['2026-11-23', '2026-11-24']);
  });

  it('finds the nth and the last weekday of a month', () => {
    const iv = parseInterval({ weekdays: [], start: '2025-12-02T17:00:00+01:00', end: '2025-12-02T19:00:00+01:00', tz: 'Europe/Berlin', freq: 'Monthly', dayOrdinal: 1, weekday: 'Tuesday', interval: 1 })!;
    const day = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86_400_000);
    expect(matchesDay(iv, day('2026-12-01'))).toBe(true);
    expect(matchesDay(iv, day('2026-12-08'))).toBe(false);
    const last = { ...iv, dayOrdinal: -1 };
    expect(matchesDay(last, day('2026-12-29'))).toBe(true);
    expect(matchesDay(last, day('2026-12-22'))).toBe(false);
  });

  it('keeps a multi-day single date that overlaps the window and drops rules it does not know', () => {
    const exhibition = { weekdays: [], start: '2026-10-01T10:00:00+02:00', end: '2027-01-10T18:00:00+01:00', tz: 'Europe/Berlin' };
    const [item] = normalizeDestinationOneEvent(record({ timeIntervals: [exhibition] }), from, to);
    expect(item.start).toBe('2026-10-01T08:00:00.000Z');
    expect(item.end).toBe('2027-01-10T17:00:00.000Z');
    const weird = { ...record().timeIntervals[0], freq: 'Fortnightly' };
    expect(normalizeDestinationOneEvent(record({ timeIntervals: [weird] }), from, to)).toEqual([]);
  });

  it('does not show a hidden end and treats midnight as "no time given"', () => {
    const iv = { weekdays: [], start: '2026-11-28T00:00:00+01:00', end: '2026-11-28T23:59:00+01:00', tz: 'Europe/Berlin', hideEnd: true };
    const [item] = normalizeDestinationOneEvent(record({ timeIntervals: [iv] }), from, to);
    expect(item.end).toBeUndefined();
    expect(item.timeKnown).toBe(false);
  });
});

describe('destination.one records', () => {
  it('maps fields without inventing any', () => {
    const [e] = normalizeDestinationOneEvent(record(), from, to);
    expect(e).toMatchObject({
      source: 'destination-one',
      title: 'Wochenmarkt Musterstadt',
      venue: 'Marktplatz',
      area: 'Musterstadt',
      address: 'Marktplatz 1, 64283 Musterstadt',
      location: { lat: 49.87, lon: 8.65 },
      category: 'markt',
      description: 'Frisches Obst und Gemüse',
      url: 'https://www.example.org/markt',
    });
    expect(e.price).toBeUndefined();
    expect(e.status).toBeUndefined();
  });

  it('only uses public-domain and CC0 records', () => {
    for (const value of ['CC-BY', 'CC-BY-SA', undefined]) {
      const attributes = value ? [{ key: 'license', value }] : [];
      expect(normalizeDestinationOneEvent(record({ attributes }), from, to)).toEqual([]);
    }
    expect(normalizeDestinationOneEvent(record({ attributes: [{ key: 'license', value: 'CC0' }] }), from, to)).toHaveLength(2);
  });

  it('drops unusable records and rejects positions outside Germany', () => {
    expect(normalizeDestinationOneEvent(record({ title: '  ' }), from, to)).toEqual([]);
    expect(normalizeDestinationOneEvent(record({ timeIntervals: [] }), from, to)).toEqual([]);
    expect(normalizeDestinationOneEvent(record({ country: 'Österreich' }), from, to)).toEqual([]);
    expect(normalizeDestinationOneEvent(null, from, to)).toEqual([]);
    const [far] = normalizeDestinationOneEvent(record({ geo: { main: { latitude: 40.4, longitude: -3.7 } } }), from, to);
    expect(far.location).toBeUndefined();
    expect(far.locationRejected).toBe(true);
    const [zero] = normalizeDestinationOneEvent(record({ geo: { main: { latitude: 0, longitude: 0 } } }), from, to);
    expect(zero.location).toBeUndefined();
  });

  it('ignores tags that say nothing about the kind of event', () => {
    const [e] = normalizeDestinationOneEvent(record({ title: 'WinterWeinprobe', categories: ['Event', 'Weinproben', 'Aktiv', 'Wein'] }), from, to);
    expect(e.category).toBe('sonstiges');
    const [k] = normalizeDestinationOneEvent(record({ title: 'MR. PUNCH', categories: ['Musikveranstaltung', 'Aktiv', 'Kultur'] }), from, to);
    expect(k.category).toBe('konzert');
  });

  it('blocks unsafe links and marks cancelled titles', () => {
    const [e] = normalizeDestinationOneEvent(record({ web: 'javascript:alert(1)', title: 'Konzert – abgesagt' }), from, to);
    expect(e.url).toBe('https://tickets.example.org/');
    expect(e.urlLabel).toBe('Kartenverkauf');
    expect(e.status).toBe('cancelled');
  });

  it('bounds the work for a broken daily rule with a huge count', () => {
    const iv = { weekdays: [], start: '1900-01-01T10:00:00+01:00', tz: 'Europe/Berlin', freq: 'Daily', interval: 1, repeatCount: 10_000_000 };
    const budget: Budget = { steps: 1000 };
    expect(normalizeDestinationOneEvent(record({ timeIntervals: [iv] }), from, to, budget)).toEqual([]);
    expect(budget.exhausted).toBe(true);
  });
});

describe('destination.one provider', () => {
  const local: ProviderQuery = { scope: 'local', center: { lat: 49.87, lon: 8.65 }, radiusKm: 25, from, to, text: 'title:Markt" OR (x)' };

  it('asks for the window, a coarse point and the radius in metres', () => {
    const u = new URL(destinationOneUrl(local));
    expect(u.origin + u.pathname).toBe('https://meta.et4.de/rest.ashx/search/');
    expect(u.searchParams.get('experience')).toBe('open-data');
    expect(u.searchParams.get('startdate')).toBe('2026-11-23');
    expect(u.searchParams.get('enddate')).toBe('2026-12-06');
    expect(u.searchParams.get('latitude')).toBe('49.87');
    expect(u.searchParams.get('distance')).toBe('25000');
    expect(u.searchParams.get('q')).toBe('title Markt OR x');
    const de = new URL(destinationOneUrl({ scope: 'de', from, to }));
    expect(de.searchParams.has('latitude')).toBe(false);
    expect(de.searchParams.has('q')).toBe(false);
  });

  const respond = (body: unknown, status = 200) => async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('returns events and reports when more exist than were fetched', async () => {
    const p = createDestinationOneProvider(respond({ status: 'OK', count: 1, overallcount: 900, items: [record()] }) as unknown as typeof fetch, 'test');
    const r = await p.fetchEvents(local);
    expect(r.events).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.checkedAt).toBeTruthy();
  });

  it('turns failures into messages that are safe to show', async () => {
    const cases: Array<[() => Promise<Response>, RegExp]> = [
      [async () => { throw new TypeError('fetch failed'); }, /nicht erreichbar/],
      [respond('', 429), /zu viele Anfragen/],
      [respond('', 503), /Fehler 503/],
      [respond('<html>'), /unlesbare Antwort/],
      [respond({ status: 'ERROR' }), /unlesbare Antwort/],
    ];
    for (const [fetchFn, msg] of cases) {
      const p = createDestinationOneProvider(fetchFn as unknown as typeof fetch);
      await expect(p.fetchEvents(local)).rejects.toThrow(ProviderError);
      await expect(p.fetchEvents(local)).rejects.toThrow(msg);
    }
  });
});
