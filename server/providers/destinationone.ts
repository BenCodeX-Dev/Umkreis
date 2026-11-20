import { inferCategory } from '../../shared/categories.ts';
import { isInGermanyBounds } from '../../shared/geo.ts';
import { isValidTimeZone, localDayKey, localParts, TZ, zonedToUtc } from '../../shared/time.ts';
import { plainText, safeHttpUrl } from '../../shared/text.ts';
import type { CategoryId, EventItem, EventStatus, GeoPoint } from '../../shared/types.ts';
import { readTextCapped } from './ics.ts';
import { ProviderError, type EventProvider, type FetchFn, type ProviderQuery } from './types.ts';

/**
 * destination.one "open-data" experience: event listings that German tourism regions publish as open
 * data (https://open.destination.one). No key needed.
 */
const ENDPOINT = 'https://meta.et4.de/rest.ashx/search/';
export const PAGE_SIZE = 300;
const MAX_BYTES = 8 * 1024 * 1024;
const DAY_MS = 86_400_000;
/** Per record: a daily event in the longest allowed window (31 days) fits. */
const MAX_OCCURRENCES_PER_RECORD = 40;
const MAX_INTERVALS_PER_RECORD = 400;
/** A repeating date longer than this is not a single sitting; its end is ignored. */
const MAX_RECURRING_SPAN_MS = 2 * DAY_MS;
/** Day steps for all records of one request – plenty for real data, bounded for broken rules. */
const MAX_STEPS_PER_REQUEST = 300_000;
/**
 * Only records that may be reused without naming the author: public domain and CC0. Records under
 * CC BY / CC BY-SA are skipped, because most of them name no author to credit.
 */
const OPEN_LICENSES = new Set(['PD', 'CC0']);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const WEEKDAY: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
type Freq = 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';
const FREQS = new Set<string>(['Daily', 'Weekly', 'Monthly', 'Yearly']);

// Calendar arithmetic on whole days (days since 1970-01-01), independent of time zones.
const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
const ymd = (day: number) => {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
const mondayOf = (day: number) => day - ((weekdayOf(day) + 6) % 7);
const localDay = (ms: number, tz: string) => {
  const p = localParts(new Date(ms), tz);
  return dayOf(p.y, p.m, p.d);
};

export interface Interval {
  startMs: number;
  /** Length of one sitting; undefined when unknown or hidden by the source. */
  spanMs?: number;
  tz: string;
  startDay: number;
  h: number;
  mi: number;
  freq?: Freq;
  interval: number;
  weekdays: number[];
  dayOrdinal?: number;
  weekday?: number;
  untilDay?: number;
  count?: number;
}

export function parseInterval(raw: unknown): Interval | null {
  const t = obj(raw);
  const startMs = Date.parse(str(t?.start) ?? '');
  if (!t || Number.isNaN(startMs)) return null;
  const tzRaw = str(t.tz);
  const tz = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : TZ;
  const lp = localParts(new Date(startMs), tz);
  const freqRaw = str(t.freq);
  const freq = freqRaw && FREQS.has(freqRaw) ? (freqRaw as Freq) : undefined;
  if (freqRaw && !freq) return null; // a rule we do not understand: better no date than a wrong one
  const endMs = Date.parse(str(t.end) ?? '');
  let spanMs = !Number.isNaN(endMs) && endMs > startMs && t.hideEnd !== true ? endMs - startMs : undefined;
  if (freq && spanMs !== undefined && spanMs > MAX_RECURRING_SPAN_MS) spanMs = undefined;
  const untilMs = Date.parse(str(t.repeatUntil) ?? '');
  const count = num(t.repeatCount);
  const ordinal = num(t.dayOrdinal);
  return {
    startMs,
    spanMs,
    tz,
    startDay: dayOf(lp.y, lp.m, lp.d),
    h: lp.h,
    mi: lp.mi,
    freq,
    interval: Math.min(52, Math.max(1, Math.floor(num(t.interval) ?? 1))),
    weekdays: arr(t.weekdays).map((w) => WEEKDAY[String(w)]).filter((w): w is number => w !== undefined),
    dayOrdinal: ordinal !== undefined && Number.isInteger(ordinal) && ordinal !== 0 ? ordinal : undefined,
    weekday: WEEKDAY[str(t.weekday) ?? ''],
    untilDay: Number.isNaN(untilMs) ? undefined : localDay(untilMs, tz),
    count: count !== undefined && count >= 1 ? Math.floor(count) : undefined,
  };
}

/** Whether the rule puts a sitting on `day`. The first date always counts, as in iCalendar. */
export function matchesDay(iv: Interval, day: number): boolean {
  const diff = day - iv.startDay;
  if (diff < 0) return false;
  if (diff === 0) return true;
  switch (iv.freq) {
    case 'Daily':
      return diff % iv.interval === 0;
    case 'Weekly': {
      const days = iv.weekdays.length ? iv.weekdays : [weekdayOf(iv.startDay)];
      return days.includes(weekdayOf(day)) && ((mondayOf(day) - mondayOf(iv.startDay)) / 7) % iv.interval === 0;
    }
    case 'Monthly': {
      const p = ymd(day), s = ymd(iv.startDay);
      if (((p.y - s.y) * 12 + p.m - s.m) % iv.interval !== 0) return false;
      if (iv.dayOrdinal === undefined || iv.weekday === undefined) return p.d === s.d;
      if (weekdayOf(day) !== iv.weekday) return false;
      return iv.dayOrdinal < 0 ? ymd(day + 7).m !== p.m : Math.ceil(p.d / 7) === iv.dayOrdinal;
    }
    case 'Yearly': {
      const p = ymd(day), s = ymd(iv.startDay);
      return p.m === s.m && p.d === s.d && (p.y - s.y) % iv.interval === 0;
    }
    default:
      return false;
  }
}

export interface Budget { steps: number; exhausted?: boolean }

/** Start instants (ms) of the sittings that overlap [from, to). */
export function expandInterval(iv: Interval, from: Date, to: Date, budget: Budget, max = MAX_OCCURRENCES_PER_RECORD): number[] {
  const fromMs = from.getTime(), toMs = to.getTime();
  const span = iv.spanMs ?? 0;
  const overlaps = (s: number) => (span > 0 ? s < toMs && s + span > fromMs : s >= fromMs && s < toMs);
  if (!iv.freq) return overlaps(iv.startMs) ? [iv.startMs] : [];

  const out: number[] = [];
  const lastDay = Math.min(localDay(toMs, iv.tz) + 1, iv.untilDay ?? Infinity);
  // With a count every earlier sitting must be counted; otherwise start just before the window.
  let day = iv.count ? iv.startDay : Math.max(iv.startDay, localDay(fromMs, iv.tz) - 3);
  let seen = 0;
  for (; day <= lastDay; day++) {
    if (--budget.steps < 0) {
      budget.exhausted = true;
      break;
    }
    if (!matchesDay(iv, day)) continue;
    if (iv.count && ++seen > iv.count) break;
    const p = ymd(day);
    const s = day === iv.startDay ? iv.startMs : zonedToUtc(p.y, p.m, p.d, iv.h, iv.mi, 0, iv.tz).getTime();
    if (overlaps(s)) {
      out.push(s);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Tags that say nothing about the kind of event ("Aktiv" is put on concerts and wine tastings alike). */
const NOISE = /^(zg |veranstaltung$|event$|dcls:|sonstiges$|sonstige$|aktiv$|winter$|sommer$)/i;
const CATEGORY_RULES: ReadonlyArray<[CategoryId, RegExp]> = [
  ['markt', /markt|märkte|basar|trödel|flohmarkt/i],
  ['party', /party|nightlife|disco|tanz/i],
  ['festival', /festival|\bfest\b|fest\/|brauchtum|umzug|kirmes|kerb|karneval|fastnacht|fasching/i],
  ['konzert', /konzert|musik|chor|orchester/i],
  ['familie', /kinder|famili/i],
  ['sport', /sport|wander|outdoor|radtour|\blauf/i],
  ['kultur', /ausstellung|kultur|bühne|theater|schauspiel|führung|besichtigung|vortrag|lesung|kunst|kino|film|museum|kabarett|comedy|oper/i],
  ['community', /treff|geselligkeit|kurs|seminar|workshop|kirche|bildung|verein/i],
];

function mapCategory(categories: string[], title: string): CategoryId {
  // A clear title wins over broad tags ("Weihnachtsmarkt" tagged only "Kultur").
  const fromTitle = inferCategory(title);
  if (fromTitle === 'markt' || fromTitle === 'festival' || fromTitle === 'party') return fromTitle;
  const tags = categories.filter((c) => !NOISE.test(c)).join(' | ');
  for (const [id, re] of CATEGORY_RULES) if (re.test(tags)) return id;
  return fromTitle ?? 'sonstiges';
}

function pickText(texts: unknown[]): string | undefined {
  const all = texts.map(obj).filter((t): t is Obj => !!t);
  for (const [rel, type] of [['details', 'text/plain'], ['teaser', 'text/plain'], ['details', 'text/html'], ['teaser', 'text/html']]) {
    const hit = all.find((t) => t.rel === rel && t.type === type && str(t.value));
    if (hit) return plainText(hit.value);
  }
  return undefined;
}

const CANCELLED = /\b(abgesagt|entfällt|fällt aus)\b/i;

/**
 * One raw record → one EventItem per sitting inside [from, to). Records without a usable licence,
 * title or date yield nothing.
 */
export function normalizeDestinationOneEvent(raw: unknown, from: Date, to: Date, budget: Budget = { steps: MAX_STEPS_PER_REQUEST }): EventItem[] {
  const e = obj(raw);
  const rawId = str(e?.id) ?? str(e?.global_id);
  const title = plainText(e?.title, 200);
  if (!e || !rawId || !title) return [];
  const id = rawId.replace(/[^\w-]/g, '').slice(0, 64);
  if (!id) return [];
  const attrs = arr(e.attributes).map(obj);
  const license = str(attrs.find((a) => a?.key === 'license')?.value);
  if (!license || !OPEN_LICENSES.has(license)) return [];
  const country = str(e.country);
  if (country && !/^(deutschland|germany|de)$/i.test(country)) return [];

  const starts = new Map<number, number | undefined>();
  for (const rawIv of arr(e.timeIntervals).slice(0, MAX_INTERVALS_PER_RECORD)) {
    const iv = parseInterval(rawIv);
    if (!iv) continue;
    for (const s of expandInterval(iv, from, to, budget)) if (!starts.has(s)) starts.set(s, iv.spanMs);
    if (budget.exhausted || starts.size >= MAX_OCCURRENCES_PER_RECORD) break;
  }
  if (starts.size === 0) return [];

  const main = obj(obj(e.geo)?.main);
  const lat = num(main?.latitude), lon = num(main?.longitude);
  let location: GeoPoint | undefined =
    lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? { lat, lon } : undefined;
  let locationRejected: true | undefined;
  if (location && !isInGermanyBounds(location)) {
    location = undefined;
    locationRejected = true;
  }
  const city = plainText(e.city, 80);
  const street = plainText(e.street, 120);
  const zip = plainText(e.zip, 10);
  const web = safeHttpUrl(e.web);
  const ticket = safeHttpUrl(arr(e.media_objects).map(obj).find((m) => m?.rel === 'PRICE_KARTENLINK')?.url);
  const categories = arr(e.categories).filter((c): c is string => typeof c === 'string');
  const status: EventStatus | undefined = CANCELLED.test(title) ? 'cancelled' : undefined;

  const base = {
    source: 'destination-one',
    sourceName: 'destination.one (Open Data)',
    title,
    venue: plainText(e.name, 120),
    area: city,
    address: [street, [zip, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || undefined,
    location,
    locationRejected,
    category: mapCategory(categories, title),
    description: pickText(arr(e.texts)),
    url: web ?? ticket,
    urlLabel: web ? 'Website zur Veranstaltung' : ticket ? 'Kartenverkauf' : undefined,
    status,
  };
  return [...starts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, span]) => {
      const start = new Date(s);
      const lp = localParts(start, TZ);
      return {
        ...base,
        id: `d1:${id}:${s}`,
        start: start.toISOString(),
        end: span ? new Date(s + span).toISOString() : undefined,
        // Midnight is how the source marks "all day" / no time given.
        timeKnown: !(lp.h === 0 && lp.mi === 0),
      };
    });
}

/** Free text for the API's search; field syntax ("title:") and operators are removed. */
const searchText = (text: string) => text.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export function destinationOneUrl(q: ProviderQuery): string {
  const params = new URLSearchParams({
    experience: 'open-data',
    type: 'Event',
    template: 'ET2014A.json',
    limit: String(PAGE_SIZE),
    startdate: localDayKey(q.from),
    enddate: localDayKey(new Date(q.to.getTime() - 1)),
  });
  if (q.center && q.radiusKm) {
    // The API sorts by distance from this point and keeps only results within `distance` metres.
    params.set('latitude', q.center.lat.toFixed(2));
    params.set('longitude', q.center.lon.toFixed(2));
    params.set('distance', String(Math.round(q.radiusKm * 1000)));
  }
  const text = q.text ? searchText(q.text) : '';
  if (text) params.set('q', text);
  return `${ENDPOINT}?${params}`;
}

export function createDestinationOneProvider(fetchFn: FetchFn = fetch, userAgent?: string): EventProvider {
  return {
    id: 'destination-one',
    name: 'destination.one (Open Data)',
    kind: 'opendata',
    async fetchEvents(q: ProviderQuery) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (userAgent) headers['User-Agent'] = userAgent;
      let res: Response;
      try {
        res = await fetchFn(destinationOneUrl(q), { signal: AbortSignal.timeout(15_000), headers });
      } catch {
        throw new ProviderError('destination.one (Open Data) ist gerade nicht erreichbar.');
      }
      if (res.status === 429) throw new ProviderError('destination.one: zu viele Anfragen. Bitte später erneut versuchen.');
      if (!res.ok) throw new ProviderError(`destination.one antwortet mit Fehler ${res.status}.`);

      let body: Obj | undefined;
      try {
        body = obj(JSON.parse(await readTextCapped(res, MAX_BYTES)));
      } catch {
        throw new ProviderError('destination.one hat eine unlesbare Antwort geliefert.');
      }
      if (!body || body.status !== 'OK' || !Array.isArray(body.items)) throw new ProviderError('destination.one hat eine unlesbare Antwort geliefert.');

      const budget: Budget = { steps: MAX_STEPS_PER_REQUEST };
      const events = body.items.flatMap((item) => normalizeDestinationOneEvent(item, q.from, q.to, budget));
      const total = num(body.overallcount) ?? 0;
      return { events, truncated: total > body.items.length || !!budget.exhausted, checkedAt: new Date().toISOString() };
    },
  };
}
