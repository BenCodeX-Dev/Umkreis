import { describe, expect, it } from 'vitest';
import { inferCategory } from '../shared/categories.ts';
import { searchCities } from '../shared/cities.ts';
import { coarsen, distanceKm, geohash, isInGermanyBounds, roundCoord } from '../shared/geo.ts';
import { plainText, safeHttpUrl } from '../shared/text.ts';
import { localDayKey, startOfLocalDay, zonedToUtc } from '../shared/time.ts';

describe('geo', () => {
  it('computes distances and coarsens coordinates to ~1 km', () => {
    expect(distanceKm({ lat: 52.52, lon: 13.4 }, { lat: 53.55, lon: 9.99 })).toBeGreaterThan(250);
    expect(distanceKm({ lat: 52.52, lon: 13.4 }, { lat: 53.55, lon: 9.99 })).toBeLessThan(260);
    expect(roundCoord(52.520008)).toBe(52.52);
    expect(coarsen({ lat: 49.873456, lon: 8.651234 })).toEqual({ lat: 49.87, lon: 8.65 });
  });

  it('checks the German bounding box', () => {
    expect(isInGermanyBounds({ lat: 49.87, lon: 8.65 })).toBe(true);
    expect(isInGermanyBounds({ lat: 48.86, lon: 2.35 })).toBe(false);
  });

  it('encodes geohashes', () => {
    expect(geohash({ lat: 57.64911, lon: 10.40744 }, 6)).toBe('u4pruy');
  });
});

describe('time (Europe/Berlin)', () => {
  it('handles DST transitions', () => {
    expect(zonedToUtc(2026, 3, 29, 1, 0).toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(zonedToUtc(2026, 3, 29, 3, 0).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(zonedToUtc(2026, 10, 25, 12, 0).toISOString()).toBe('2026-10-25T11:00:00.000Z');
  });

  it('derives German calendar days', () => {
    expect(localDayKey(new Date('2026-11-20T23:30:00Z'))).toBe('2026-11-21');
    expect(startOfLocalDay(new Date('2026-11-20T12:00:00Z')).toISOString()).toBe('2026-11-19T23:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-03-28T12:00:00Z'), 1).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-03-29T12:00:00Z'), 1).toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });
});

describe('text and categories', () => {
  it('allows only http(s) links', () => {
    expect(safeHttpUrl('https://example.org/a')).toBe('https://example.org/a');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,x')).toBeUndefined();
    expect(safeHttpUrl(42)).toBeUndefined();
  });

  it('strips markup from descriptions', () => {
    expect(plainText('<p>Hallo <script>x</script>Welt</p>')).not.toMatch(/[<>]/);
  });

  it('infers categories from German titles', () => {
    expect(inferCategory('Wochenmarkt am Rathaus')).toBe('markt');
    expect(inferCategory('Kerb in Jugenheim')).toBe('festival');
    expect(inferCategory('Ü30 Party')).toBe('party');
    expect(inferCategory('Treffen am Marktplatz')).not.toBe('markt');
  });

  it('finds cities without diacritics', () => {
    expect(searchCities('munchen')[0]?.label).toMatch(/München/);
  });
});
