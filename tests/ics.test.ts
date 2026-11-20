import { describe, expect, it } from 'vitest';
import { expandOccurrences, parseIcs, unfold } from '../server/ics.ts';
import { icsEventToItems, validateFeed, type FeedConfig } from '../server/providers/ics.ts';

const cal = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');
const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const iso = (d: Date) => d.toISOString();

const feed: FeedConfig = {
  id: 'stadt',
  name: 'Stadt Musterstadt',
  url: 'https://example.org/kalender.ics',
  website: 'https://example.org/veranstaltungen',
  category: 'community',
  area: { label: 'Musterstadt', lat: 49.87, lon: 8.65 },
};

describe('unfold', () => {
  it('joins folded continuation lines', () => {
    expect(unfold('SUMMARY:Wochen\r\n markt\r\nX:1')).toEqual(['SUMMARY:Wochenmarkt', 'X:1']);
  });
});

describe('parseIcs', () => {
  it('converts TZID times to UTC across DST', () => {
    const [winter, summer] = parseIcs(
      cal(
        vevent('UID:a', 'SUMMARY:Winter', 'DTSTART;TZID=Europe/Berlin:20261121T080000'),
        vevent('UID:b', 'SUMMARY:Sommer', 'DTSTART;TZID="Europe/Berlin":20260704T200000'),
      ),
    );
    expect(iso(winter.start.utc)).toBe('2026-11-21T07:00:00.000Z');
    expect(iso(summer.start.utc)).toBe('2026-07-04T18:00:00.000Z');
  });

  it('treats floating times and unknown zones as German time, and handles all-day dates', () => {
    const evs = parseIcs(
      cal(
        vevent('UID:a', 'SUMMARY:Floating', 'DTSTART:20261121T100000'),
        vevent('UID:b', 'SUMMARY:Windows', 'DTSTART;TZID=W. Europe Standard Time:20261121T100000'),
        vevent('UID:c', 'SUMMARY:Ganztags', 'DTSTART;VALUE=DATE:20261205'),
        vevent('UID:d', 'SUMMARY:UTC', 'DTSTART:20261121T100000Z'),
      ),
    );
    expect(iso(evs[0].start.utc)).toBe('2026-11-21T09:00:00.000Z');
    expect(iso(evs[1].start.utc)).toBe('2026-11-21T09:00:00.000Z');
    expect(evs[2].start.dateOnly).toBe(true);
    expect(iso(evs[2].start.utc)).toBe('2026-12-04T23:00:00.000Z');
    expect(iso(evs[3].start.utc)).toBe('2026-11-21T10:00:00.000Z');
  });

  it('reads GEO, CATEGORIES, escaped text and skips events without a start', () => {
    const evs = parseIcs(
      cal(
        vevent('UID:a', 'SUMMARY:Flohmarkt\\, groß', 'DTSTART:20261121T100000', 'GEO:49.8712;8.6523', 'CATEGORIES:Markt,Familie'),
        vevent('UID:b', 'SUMMARY:Ohne Datum'),
      ),
    );
    expect(evs).toHaveLength(1);
    expect(evs[0].summary).toBe('Flohmarkt, groß');
    expect(evs[0].geo).toEqual({ lat: 49.8712, lon: 8.6523 });
    expect(evs[0].categories).toEqual(['Markt', 'Familie']);
  });
});

describe('expandOccurrences', () => {
  const from = new Date('2026-11-20T00:00:00Z');
  const one = (...lines: string[]) => parseIcs(cal(vevent('UID:x', 'SUMMARY:X', ...lines)))[0];

  it('expands a weekly market and honours EXDATE', () => {
    const ev = one('DTSTART;TZID=Europe/Berlin:20261003T080000', 'DTEND;TZID=Europe/Berlin:20261003T130000', 'RRULE:FREQ=WEEKLY;BYDAY=SA', 'EXDATE;TZID=Europe/Berlin:20261128T080000');
    const occ = expandOccurrences(ev, from, new Date('2026-12-13T00:00:00Z'));
    expect(occ.map((o) => iso(o.start))).toEqual(['2026-11-21T07:00:00.000Z', '2026-12-05T07:00:00.000Z', '2026-12-12T07:00:00.000Z']);
    expect(iso(occ[0].end!)).toBe('2026-11-21T12:00:00.000Z');
  });

  it('expands "first Saturday of the month"', () => {
    const ev = one('DTSTART;TZID=Europe/Berlin:20260103T090000', 'RRULE:FREQ=MONTHLY;BYDAY=1SA');
    const occ = expandOccurrences(ev, new Date('2026-11-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'));
    expect(occ.map((o) => iso(o.start))).toEqual(['2026-11-07T08:00:00.000Z', '2026-12-05T08:00:00.000Z']);
  });

  it('respects COUNT and UNTIL', () => {
    const counted = one('DTSTART;TZID=Europe/Berlin:20261119T180000', 'RRULE:FREQ=DAILY;COUNT=3');
    expect(expandOccurrences(counted, from, new Date('2026-12-01T00:00:00Z'))).toHaveLength(2);
    const until = one('DTSTART;TZID=Europe/Berlin:20261120T180000', 'RRULE:FREQ=DAILY;UNTIL=20261122T235959Z');
    expect(expandOccurrences(until, from, new Date('2026-12-01T00:00:00Z'))).toHaveLength(3);
  });

  it('never invents occurrences for unsupported rules', () => {
    const ev = one('DTSTART;TZID=Europe/Berlin:20261121T100000', 'RRULE:FREQ=HOURLY');
    expect(expandOccurrences(ev, from, new Date('2026-11-23T00:00:00Z'))).toHaveLength(1);
  });
});

describe('icsEventToItems', () => {
  const window = [new Date('2026-11-20T00:00:00Z'), new Date('2026-11-30T00:00:00Z')] as const;

  it('maps fields, falls back to feed area and website, and rejects unsafe URLs', () => {
    const [ev] = parseIcs(
      cal(vevent('UID:m1', 'SUMMARY:Weihnachtsmarkt', 'DTSTART;TZID=Europe/Berlin:20261121T110000', 'DESCRIPTION:Eintritt frei!', 'LOCATION:Marktplatz', 'URL:javascript:alert(1)')),
    );
    const [item] = icsEventToItems(feed, ev, ...window);
    expect(item).toMatchObject({
      source: 'ics:stadt',
      sourceName: 'Stadt Musterstadt',
      isDemo: false,
      title: 'Weihnachtsmarkt',
      category: 'markt',
      venue: 'Marktplatz',
      location: { lat: 49.87, lon: 8.65 },
      locationApprox: true,
      url: 'https://example.org/veranstaltungen',
      price: { currency: 'EUR', free: true, fromText: true },
      timeKnown: true,
    });
  });

  it('marks cancelled events and keeps exact GEO positions', () => {
    const [ev] = parseIcs(cal(vevent('UID:c1', 'SUMMARY:Konzert', 'DTSTART:20261122T190000', 'GEO:49.9;8.7', 'STATUS:CANCELLED', 'URL:https://example.org/k')));
    const [item] = icsEventToItems(feed, ev, ...window);
    expect(item.status).toBe('cancelled');
    expect(item.location).toEqual({ lat: 49.9, lon: 8.7 });
    expect(item.locationApprox).toBeFalsy();
    expect(item.url).toBe('https://example.org/k');
  });
});

describe('validateFeed', () => {
  it('accepts a valid feed and rejects non-http URLs', () => {
    expect(validateFeed(feed)).toMatchObject({ id: 'stadt' });
    expect(typeof validateFeed({ ...feed, url: 'file:///etc/passwd' })).toBe('string');
    expect(typeof validateFeed({ name: 'x' })).toBe('string');
  });
});
