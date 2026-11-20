import { describe, expect, it } from 'vitest';
import { createTicketmasterProvider, normalizeTicketmasterEvent } from '../server/providers/ticketmaster.ts';
import { ProviderError } from '../server/providers/types.ts';

const raw = {
  id: 'G5abc',
  name: 'Jazz im Park',
  url: 'https://www.ticketmaster.de/event/123',
  info: '<b>Open Air</b> mit Bigband',
  dates: { start: { localDate: '2026-11-21', localTime: '20:00:00', dateTime: '2026-11-21T19:00:00Z' }, status: { code: 'onsale' } },
  classifications: [{ segment: { name: 'Music' }, genre: { name: 'Jazz' } }],
  priceRanges: [{ type: 'standard', currency: 'EUR', min: 25, max: 49.5 }],
  _embedded: {
    venues: [{ name: 'Stadthalle', city: { name: 'Darmstadt' }, postalCode: '64283', address: { line1: 'Hauptstr. 1' }, location: { latitude: '49.872', longitude: '8.651' } }],
  },
};

describe('normalizeTicketmasterEvent', () => {
  it('maps a complete record', () => {
    expect(normalizeTicketmasterEvent(raw)).toMatchObject({
      id: 'tm:G5abc',
      isDemo: false,
      title: 'Jazz im Park',
      start: '2026-11-21T19:00:00.000Z',
      timeKnown: true,
      venue: 'Stadthalle',
      area: 'Darmstadt',
      address: 'Hauptstr. 1, 64283 Darmstadt',
      location: { lat: 49.872, lon: 8.651 },
      category: 'konzert',
      price: { currency: 'EUR', min: 25, max: 49.5 },
      description: 'Open Air mit Bigband',
      url: 'https://www.ticketmaster.de/event/123',
    });
  });

  it('skips undated or untitled records instead of guessing', () => {
    expect(normalizeTicketmasterEvent({ ...raw, dates: { start: { dateTBA: true } } })).toBeNull();
    expect(normalizeTicketmasterEvent({ ...raw, name: '' })).toBeNull();
    expect(normalizeTicketmasterEvent(null)).toBeNull();
  });

  it('handles unknown time, zero prices, unsafe URLs and cancellations', () => {
    const e = normalizeTicketmasterEvent({
      ...raw,
      url: 'javascript:alert(1)',
      priceRanges: [{ currency: 'EUR', min: 0, max: 0 }],
      dates: { start: { localDate: '2026-11-21', timeTBA: true }, status: { code: 'cancelled' } },
      _embedded: undefined,
    })!;
    expect(e.timeKnown).toBe(false);
    expect(e.start).toBe('2026-11-20T23:00:00.000Z');
    expect(e.price).toBeUndefined();
    expect(e.url).toBeUndefined();
    expect(e.location).toBeUndefined();
    expect(e.status).toBe('cancelled');
  });
});

describe('createTicketmasterProvider', () => {
  const q = { scope: 'local' as const, center: { lat: 49.87, lon: 8.65 }, radiusKm: 15, from: new Date('2026-11-20T00:00:00Z'), to: new Date('2026-11-21T00:00:00Z') };

  it('sends a geo query and normalises results', async () => {
    let url = '';
    const fetchFn = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ _embedded: { events: [raw, { id: 'bad' }] }, page: { totalElements: 2 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await createTicketmasterProvider('KEY', fetchFn).fetchEvents(q);
    const params = new URL(url).searchParams;
    expect(params.get('geoPoint')).toMatch(/^[0-9a-z]{6}$/);
    expect(params.get('radius')).toBe('15');
    expect(params.get('unit')).toBe('km');
    expect(params.get('countryCode')).toBe('DE');
    expect(params.get('startDateTime')).toBe('2026-11-20T00:00:00Z');
    expect(params.has('latlong')).toBe(false);
    expect(res.events).toHaveLength(1);
    expect(res.truncated).toBe(false);
  });

  it('turns HTTP failures into user-safe errors', async () => {
    const status = (s: number) => (async () => new Response('{}', { status: s })) as unknown as typeof fetch;
    await expect(createTicketmasterProvider('KEY', status(401)).fetchEvents(q)).rejects.toThrow(ProviderError);
    await expect(createTicketmasterProvider('KEY', status(429)).fetchEvents(q)).rejects.toThrow(/Ratenlimit/);
    const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await expect(createTicketmasterProvider('KEY', offline).fetchEvents(q)).rejects.toThrow(/nicht erreichbar/);
  });
});
