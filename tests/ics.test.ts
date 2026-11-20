import { describe, expect, it } from 'vitest';
import { expandOccurrences, parseIcs, unfold } from '../server/ics.ts';
import { icsEventToItems, plausibleGeo, readTextCapped, validateFeed, type FeedConfig } from '../server/providers/ics.ts';

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

  it('counts long COUNT series from a distant DTSTART exactly', () => {
    const to = new Date('2026-12-01T00:00:00Z');
    // 2000-01-01 + 9820 days = 2026-11-20, so COUNT=9823 ends on 2026-11-22.
    const ending = one('DTSTART;TZID=Europe/Berlin:20000101T180000', 'RRULE:FREQ=DAILY;COUNT=9823');
    expect(expandOccurrences(ending, from, to).map((o) => iso(o.start))).toEqual([
      '2026-11-20T17:00:00.000Z',
      '2026-11-21T17:00:00.000Z',
      '2026-11-22T17:00:00.000Z',
    ]);
    const ended = one('DTSTART;TZID=Europe/Berlin:20000101T180000', 'RRULE:FREQ=DAILY;COUNT=9000');
    expect(expandOccurrences(ended, from, to)).toEqual([]);
  });

  it('stops when the shared step budget is used up and says so', () => {
    const ev = one('DTSTART;TZID=Europe/Berlin:20000101T180000', 'RRULE:FREQ=DAILY;COUNT=9823');
    const budget = { steps: 100, exhausted: false };
    expect(expandOccurrences(ev, from, new Date('2026-12-01T00:00:00Z'), 100, budget)).toEqual([]);
    expect(budget.exhausted).toBe(true);
  });

  it('replaces a moved instance (RECURRENCE-ID) instead of showing it twice', () => {
    const [master, moved] = parseIcs(
      cal(
        vevent('UID:m', 'SUMMARY:Markt', 'DTSTART;TZID=Europe/Berlin:20261003T080000', 'RRULE:FREQ=WEEKLY;BYDAY=SA'),
        vevent('UID:m', 'SUMMARY:Markt', 'RECURRENCE-ID;TZID=Europe/Berlin:20261121T080000', 'DTSTART;TZID=Europe/Berlin:20261121T100000'),
      ),
    );
    const to = new Date('2026-11-29T00:00:00Z');
    expect(expandOccurrences(master, from, to).map((o) => iso(o.start))).toEqual(['2026-11-28T07:00:00.000Z']);
    expect(expandOccurrences(moved, from, to).map((o) => iso(o.start))).toEqual(['2026-11-21T09:00:00.000Z']);
  });
});

describe('feed limits', () => {
  it('keeps at most maxEvents VEVENTs', () => {
    const many = cal(...Array.from({ length: 5 }, (_, i) => vevent(`UID:${i}`, 'SUMMARY:X', 'DTSTART:20261121T100000Z')));
    expect(parseIcs(many, 3)).toHaveLength(3);
  });

  const streamOf = (chunks: Uint8Array[], onCancel?: () => void) =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          const next = chunks.shift();
          if (next) c.enqueue(next);
          else c.close();
        },
        cancel: onCancel,
      }),
    );

  it('reads a body under the limit, also across split UTF-8 characters', async () => {
    const bytes = new TextEncoder().encode('Kränzchen');
    expect(await readTextCapped(streamOf([bytes.slice(0, 3), bytes.slice(3)]), 100)).toBe('Kränzchen');
  });

  it('cancels the download as soon as the limit is passed, even without Content-Length', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(64);
    const res = streamOf([chunk, chunk, chunk, chunk], () => (cancelled = true));
    await expect(readTextCapped(res, 100)).rejects.toThrow();
    expect(cancelled).toBe(true);
  });

  it('rejects an announced oversized body before reading it', async () => {
    const res = new Response('x', { headers: { 'content-length': '999999' } });
    await expect(readTextCapped(res, 100)).rejects.toThrow();
    expect(res.bodyUsed).toBe(false);
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

  it('does not trust GEO positions far from the feed area or outside Germany', () => {
    const at = (geo: string) => icsEventToItems(feed, parseIcs(cal(vevent('UID:g', 'SUMMARY:Fest', 'DTSTART:20261122T190000', `GEO:${geo}`)))[0], ...window)[0];
    const far = at('53.55;9.99'); // Hamburg, ~400 km from Musterstadt
    expect(far.location).toEqual({ lat: 49.87, lon: 8.65 });
    expect(far).toMatchObject({ locationApprox: true, locationRejected: true });
    const swapped = at('8.65;49.87'); // lat/lon swapped: Gulf of Guinea → outside Germany
    expect(swapped).toMatchObject({ locationApprox: true, locationRejected: true });
    const near = at('49.99;8.8');
    expect(near.location).toEqual({ lat: 49.99, lon: 8.8 });
    expect(near.locationRejected).toBeUndefined();
    expect(plausibleGeo({ ...feed, area: { ...feed.area!, radiusKm: 500 } }, { lat: 53.55, lon: 9.99 })).toBeDefined();
    const noArea: FeedConfig = { ...feed, area: undefined };
    expect(plausibleGeo(noArea, { lat: 53.55, lon: 9.99 })).toBeDefined();
    expect(plausibleGeo(noArea, { lat: 48.85, lon: 2.35 })).toBeUndefined(); // Paris
    const abroad = icsEventToItems(noArea, parseIcs(cal(vevent('UID:p', 'SUMMARY:Fest', 'DTSTART:20261122T190000', 'GEO:48.85;2.35')))[0], ...window)[0];
    expect(abroad.location).toBeUndefined();
    expect(abroad.locationRejected).toBe(true);
  });
});

describe('validateFeed', () => {
  it('accepts a valid feed and rejects non-http URLs', () => {
    expect(validateFeed(feed)).toMatchObject({ id: 'stadt' });
    expect(typeof validateFeed({ ...feed, url: 'file:///etc/passwd' })).toBe('string');
    expect(typeof validateFeed({ name: 'x' })).toBe('string');
  });

  it('requires the feed area to lie in Germany and its radius to be sane', () => {
    expect(typeof validateFeed({ ...feed, area: { label: 'Paris', lat: 48.85, lon: 2.35 } })).toBe('string');
    expect(typeof validateFeed({ ...feed, area: { ...feed.area, radiusKm: 0 } })).toBe('string');
    expect(typeof validateFeed({ ...feed, area: { ...feed.area, radiusKm: '50' } })).toBe('string');
    expect(validateFeed({ ...feed, area: { ...feed.area, radiusKm: 120 } })).toMatchObject({ area: { radiusKm: 120 } });
  });
});
