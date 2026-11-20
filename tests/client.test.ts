import { describe, expect, it } from 'vitest';
import type { EventItem } from '../shared/types.ts';
import { sanitizeEvent } from '../src/lib/api.ts';
import { buildIcs } from '../src/lib/calendar.ts';
import { formatDayHeading, isOver, rangeWindow } from '../src/lib/dates.ts';
import { groupByDay, rankEvents } from '../src/lib/filter.ts';
import { formatDistance, formatPrice } from '../src/lib/format.ts';
import { mapTarget } from '../src/lib/maps.ts';
import { applyThemePref, isThemePref, loadThemePref, resolveTheme } from '../src/lib/theme.ts';

const ev = (over: Partial<EventItem> = {}): EventItem => ({
  id: 'x1',
  source: 'test',
  sourceName: 'Test',
  isDemo: false,
  title: 'Konzert',
  start: '2026-11-21T19:00:00.000Z',
  timeKnown: true,
  category: 'konzert',
  ...over,
});

describe('rangeWindow', () => {
  it('builds day-aligned windows in German time', () => {
    const fri = new Date('2026-11-20T11:00:00Z');
    expect(rangeWindow('heute', fri)).toEqual({ from: new Date('2026-11-19T23:00:00Z'), to: new Date('2026-11-20T23:00:00Z') });
    expect(rangeWindow('wochenende', fri)).toEqual({ from: new Date('2026-11-19T23:00:00Z'), to: new Date('2026-11-22T23:00:00Z') });
    const wed = new Date('2026-11-18T11:00:00Z');
    expect(rangeWindow('wochenende', wed)).toEqual({ from: new Date('2026-11-19T23:00:00Z'), to: new Date('2026-11-22T23:00:00Z') });
    const sun = new Date('2026-11-22T11:00:00Z');
    expect(rangeWindow('wochenende', sun)).toEqual({ from: new Date('2026-11-21T23:00:00Z'), to: new Date('2026-11-22T23:00:00Z') });
  });
});

describe('isOver', () => {
  const now = new Date('2026-11-21T23:00:00Z');
  it('uses the end time, a 3 h default, or the whole day for date-only events', () => {
    expect(isOver(ev({ start: '2026-11-21T20:30:00.000Z' }), now)).toBe(false);
    expect(isOver(ev({ start: '2026-11-21T18:00:00.000Z' }), now)).toBe(true);
    expect(isOver(ev({ start: '2026-11-21T10:00:00.000Z', end: '2026-11-22T10:00:00.000Z' }), now)).toBe(false);
    expect(isOver(ev({ start: '2026-11-20T23:00:00.000Z', timeKnown: false }), new Date('2026-11-21T22:00:00Z'))).toBe(false);
  });
});

describe('rankEvents / groupByDay', () => {
  const now = new Date('2026-11-21T08:00:00Z');
  const home = { lat: 49.87, lon: 8.65 };
  const events = [
    ev({ id: 'a', title: 'Wochenmarkt', category: 'markt', start: '2026-11-21T09:00:00.000Z', location: { lat: 49.871, lon: 8.651 }, price: { currency: 'EUR', free: true } }),
    ev({ id: 'b', title: 'Jazzabend', category: 'konzert', start: '2026-11-21T08:30:00.000Z', location: { lat: 49.95, lon: 8.65 } }),
    ev({ id: 'c', title: 'Café Kränzchen', category: 'community', start: '2026-11-22T14:00:00.000Z' }),
    ev({ id: 'old', title: 'Vorbei', start: '2026-11-20T08:00:00.000Z' }),
  ];
  const base = { categories: [], text: '', sort: 'zeit' as const, interests: ['markt' as const], home, now, windowFrom: new Date('2026-11-20T23:00:00Z') };

  it('explains highlights and computes distances', () => {
    const ranked = rankEvents(events, base);
    expect(ranked.map((r) => r.event.id)).toEqual(['a', 'b', 'c']);
    const market = ranked[0];
    expect(market.matchesInterest).toBe(true);
    expect(market.reasons.join(' ')).toMatch(/Märkte/);
    expect(market.reasons).toContain('kostenlos');
    expect(ranked[1].reasons).toEqual([]);
    expect(ranked[1].distanceKm).toBeGreaterThan(8);
    expect(ranked[2].distanceKm).toBeUndefined();
  });

  it('marks proximity of demo events as simulated', () => {
    const demo = ev({ ...events[0], id: 'd', isDemo: true });
    expect(rankEvents([demo], base)[0].reasons).toContain('ganz in der Nähe (unter 2 km, simuliert)');
    expect(rankEvents([events[0]], base)[0].reasons).toContain('ganz in der Nähe (unter 2 km)');
  });

  it('filters by category and accent-insensitive text', () => {
    expect(rankEvents(events, { ...base, categories: ['konzert'] }).map((r) => r.event.id)).toEqual(['b']);
    expect(rankEvents(events, { ...base, text: 'kranzchen' }).map((r) => r.event.id)).toEqual(['c']);
  });

  it('groups by day and sorts within a day', () => {
    const ranked = rankEvents(events, base);
    const byTime = groupByDay(ranked, 'zeit', base.windowFrom);
    expect(byTime.map((g) => g.dayKey)).toEqual(['2026-11-21', '2026-11-22']);
    expect(byTime[0].items.map((r) => r.event.id)).toEqual(['b', 'a']);
    expect(groupByDay(ranked, 'interessen', base.windowFrom)[0].items[0].event.id).toBe('a');
    expect(groupByDay(ranked, 'entfernung', base.windowFrom)[0].items[0].event.id).toBe('a');
  });
});

describe('formatDayHeading', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  it('names today and tomorrow, otherwise the weekday', () => {
    expect(formatDayHeading('2026-11-21', now).lead).toBe('Heute');
    expect(formatDayHeading('2026-11-22', now).lead).toBe('Morgen');
    const later = formatDayHeading('2026-11-24', now);
    expect(later.lead).toBe('Dienstag');
    expect(later.date).toBe('24. November');
  });
});

describe('format', () => {
  const norm = (s: string) => s.replace(/\s/g, ' ');
  it('formats distances honestly', () => {
    expect(formatDistance(3.24)).toBe('ca. 3,2 km');
    expect(formatDistance(0.4)).toBe('unter 1 km');
    expect(formatDistance(12.6)).toBe('ca. 13 km');
    expect(formatDistance(2, true)).toBe('ca. 2,0 km (Ortsmitte)');
    expect(formatDistance(undefined)).toBe('Entfernung unbekannt');
  });
  it('formats prices without inventing them', () => {
    expect(formatPrice(undefined)).toBe('Preis unbekannt');
    expect(norm(formatPrice({ currency: 'EUR', min: 25, max: 49.5 }))).toBe('25 € – 49,50 €');
    expect(norm(formatPrice({ currency: 'EUR', min: 12 }))).toBe('ab 12 €');
    expect(formatPrice({ currency: 'EUR', free: true, fromText: true })).toBe('Kostenlos (laut Beschreibung)');
    expect(formatPrice({ currency: 'XX', min: 3 })).toBe('Preis unbekannt');
  });
});

describe('sanitizeEvent', () => {
  it('drops malformed items and unsafe links', () => {
    expect(sanitizeEvent({ id: 'x' })).toBeNull();
    expect(sanitizeEvent({ ...ev(), category: 'unbekannt' })).toBeNull();
    expect(sanitizeEvent({ ...ev(), url: 'javascript:alert(1)' })?.url).toBeUndefined();
  });
});

describe('buildIcs', () => {
  it('creates a valid single-event calendar with reminder', () => {
    const ics = buildIcs(ev({ title: 'Jazz; Blues, Soul', venue: 'Stadthalle', url: 'https://example.org/e', description: 'x'.repeat(200) }), new Date('2026-11-20T10:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261121T190000Z');
    expect(ics).toContain('SUMMARY:Jazz\\; Blues\\, Soul');
    expect(ics).toContain('TRIGGER:-PT1H');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it('labels demo events and writes date-only events as all-day', () => {
    const ics = buildIcs(ev({ isDemo: true, timeKnown: false, start: '2026-11-20T23:00:00.000Z' }));
    expect(ics).toContain('SUMMARY:[Beispiel] Konzert');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261121');
    expect(ics).toContain('DTEND;VALUE=DATE:20261122');
    expect(ics).not.toContain('VALARM');
  });
});

describe('mapTarget', () => {
  it('links precise venue coordinates in four map apps, destination only', () => {
    const t = mapTarget(ev({ venue: 'Centralstation', location: { lat: 49.8728253, lon: 8.6511929 } }));
    expect(t?.by).toBe('coordinates');
    const href = Object.fromEntries(t!.links.map((l) => [l.provider, l.href]));
    expect(href.apple).toBe('https://maps.apple.com/place?coordinate=49.87283,8.65119&name=Centralstation');
    expect(href.google).toBe('https://www.google.com/maps/search/?api=1&query=49.87283%2C8.65119');
    expect(href.here).toBe('https://share.here.com/l/49.87283,8.65119,Centralstation?z=17&p=yes');
    expect(href.osm).toBe('https://www.openstreetmap.org/?mlat=49.87283&mlon=8.65119#map=17/49.87283/8.65119');
    for (const l of t!.links) expect(l.href.startsWith('https://')).toBe(true);
  });
  it('falls back to an address search when the position is only approximate', () => {
    const t = mapTarget(ev({ venue: 'Stadthalle', area: 'Bensheim', location: { lat: 49.68, lon: 8.62 }, locationApprox: true }));
    expect(t?.by).toBe('address');
    expect(t!.links.map((l) => l.provider)).toEqual(['apple', 'google', 'osm']);
    expect(t!.links[0].href).toBe('https://maps.apple.com/search?query=Stadthalle%2C%20Bensheim');
    expect(t!.links.some((l) => l.href.includes('49.68'))).toBe(false);
  });
  it('offers nothing for demo events or places that cannot be found', () => {
    expect(mapTarget(ev({ isDemo: true, venue: 'X', area: 'Y', location: { lat: 1, lon: 2 } }))).toBeNull();
    expect(mapTarget(ev({ venue: 'Stadthalle' }))).toBeNull();
    expect(mapTarget(ev())).toBeNull();
  });
});

describe('theme', () => {
  it('resolves auto from the system and keeps explicit choices', () => {
    expect(resolveTheme('auto', true)).toBe('night');
    expect(resolveTheme('auto', false)).toBe('day');
    expect(resolveTheme('day', true)).toBe('day');
    expect(resolveTheme('night', false)).toBe('night');
    expect(isThemePref('dunkel')).toBe(false);
  });
  it('defaults to auto without storage and sets or clears data-theme', () => {
    expect(loadThemePref()).toBe('auto');
    const root = { dataset: {} as DOMStringMap };
    applyThemePref('night', root);
    expect(root.dataset.theme).toBe('night');
    applyThemePref('auto', root);
    expect(root.dataset.theme).toBeUndefined();
  });
});
