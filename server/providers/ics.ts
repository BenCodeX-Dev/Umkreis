import { inferCategory, isCategoryId } from '../../shared/categories.ts';
import { distanceKm, isInGermanyBounds } from '../../shared/geo.ts';
import { hashString, plainText, safeHttpUrl } from '../../shared/text.ts';
import type { CategoryId, EventItem, GeoPoint, PriceInfo } from '../../shared/types.ts';
import { TtlCache } from '../cache.ts';
import { expandOccurrences, MAX_EVENTS, parseIcs, type ExpandBudget, type IcsEvent } from '../ics.ts';
import { ProviderError, type EventProvider, type FetchFn } from './types.ts';

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  website?: string;
  category?: CategoryId;
  /** Centre of the area the calendar covers; `radiusKm` is how far its events may lie from it. */
  area?: GeoPoint & { label: string; radiusKm?: number };
}

/** Default reach of a feed area – a city plus its surrounding district. */
export const DEFAULT_AREA_RADIUS_KM = 50;

/**
 * A feed's GEO is a claim, not a fact: it is used only inside Germany and, when the feed names an
 * area, within that area's reach. Anything else (typos, swapped lat/lon, spoofed positions) is dropped.
 */
export function plausibleGeo(feed: FeedConfig, geo: GeoPoint | undefined): GeoPoint | undefined {
  if (!geo || !isInGermanyBounds(geo)) return undefined;
  if (feed.area && distanceKm(feed.area, geo) > (feed.area.radiusKm ?? DEFAULT_AREA_RADIUS_KM)) return undefined;
  return geo;
}

const MAX_BYTES = 5 * 1024 * 1024;
/** Recurrence day steps per feed and request – generous for real calendars, bounded for broken ones. */
const MAX_STEPS_PER_REQUEST = 500_000;

class TooLarge extends Error {}

/** Reads the body as UTF-8 text and stops (cancelling the download) as soon as it exceeds `limit` bytes. */
export async function readTextCapped(res: Response, limit: number): Promise<string> {
  if (Number(res.headers.get('content-length') ?? 0) > limit) throw new TooLarge();
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
const FREE_RE = /eintritt (ist )?frei|freier eintritt|kostenlos|kostenfrei|free admission/i;

export function validateFeed(raw: unknown): FeedConfig | string {
  const f = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (typeof f.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(f.id)) return 'id fehlt oder ungültig (a-z, 0-9, -)';
  if (typeof f.name !== 'string' || !f.name.trim()) return `${f.id}: name fehlt`;
  const url = safeHttpUrl(f.url);
  if (!url) return `${f.id}: url muss mit http(s):// beginnen`;
  const feed: FeedConfig = { id: f.id, name: f.name.trim(), url, website: safeHttpUrl(f.website) };
  if (f.category !== undefined) {
    if (!isCategoryId(f.category)) return `${f.id}: unbekannte Kategorie`;
    feed.category = f.category;
  }
  if (f.area !== undefined) {
    const a = f.area as Record<string, unknown>;
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || typeof a.label !== 'string') return `${f.id}: area braucht label, lat, lon`;
    if (!isInGermanyBounds({ lat: a.lat, lon: a.lon })) return `${f.id}: area liegt außerhalb Deutschlands`;
    feed.area = { label: a.label, lat: a.lat, lon: a.lon };
    if (a.radiusKm !== undefined) {
      if (typeof a.radiusKm !== 'number' || !(a.radiusKm >= 1 && a.radiusKm <= 500)) return `${f.id}: area.radiusKm muss zwischen 1 und 500 liegen`;
      feed.area.radiusKm = a.radiusKm;
    }
  }
  return feed;
}

export function icsEventToItems(feed: FeedConfig, ev: IcsEvent, from: Date, to: Date, budget?: ExpandBudget): EventItem[] {
  const title = plainText(ev.summary, 160);
  if (!title) return [];
  const description = plainText(ev.description);
  const category = inferCategory(`${ev.categories.join(' ')} ${title}`) ?? feed.category ?? inferCategory(description ?? '') ?? 'sonstiges';
  const price: PriceInfo | undefined = description && FREE_RE.test(description) ? { currency: 'EUR', free: true, fromText: true } : undefined;
  const eventUrl = safeHttpUrl(ev.url);
  const baseId = hashString(ev.uid ?? `${title}|${ev.start.utc.toISOString()}`);
  const geo = plausibleGeo(feed, ev.geo);

  return expandOccurrences(ev, from, to, 100, budget).map((occ) => ({
    id: `ics:${feed.id}:${baseId}:${occ.start.getTime()}`,
    source: `ics:${feed.id}`,
    sourceName: feed.name,
    title,
    start: occ.start.toISOString(),
    end: occ.end?.toISOString(),
    timeKnown: !ev.start.dateOnly,
    allDay: ev.start.dateOnly || undefined,
    venue: plainText(ev.location, 160),
    area: feed.area?.label,
    location: geo ?? (feed.area ? { lat: feed.area.lat, lon: feed.area.lon } : undefined),
    locationApprox: !geo && !!feed.area,
    locationRejected: (!!ev.geo && !geo) || undefined,
    category,
    price,
    description,
    url: eventUrl ?? feed.website,
    urlLabel: eventUrl ? 'Originalanzeige' : feed.website ? 'Zum Veranstaltungskalender' : undefined,
    status: ev.status === 'CANCELLED' ? 'cancelled' : undefined,
  }));
}

type Loaded = { events: IcsEvent[]; checkedAt: string };

/**
 * `failurePauseMs`: after a failed download the feed is not asked again for this long. Without it, a calendar
 * server that is down would hold up every search for the full timeout.
 */
export function createIcsProvider(feed: FeedConfig, fetchFn: FetchFn = fetch, ttlMs = 15 * 60_000, failurePauseMs = 5 * 60_000): EventProvider {
  const cache = new TtlCache<Loaded>(ttlMs, 1);
  const tooLarge = () => new ProviderError(`${feed.name}: Kalenderdatei ist zu groß.`);
  let pending: Promise<Loaded> | undefined;
  let failed: { error: ProviderError; until: number } | undefined;

  function load(): Promise<Loaded> {
    const hit = cache.get('feed');
    if (hit) return Promise.resolve(hit);
    if (failed && Date.now() < failed.until) return Promise.reject(failed.error);
    // Searches arriving while the file is being downloaded share that one download.
    pending ??= download()
      .then(
        (loaded) => {
          failed = undefined;
          return loaded;
        },
        (err: unknown) => {
          if (err instanceof ProviderError) failed = { error: err, until: Date.now() + failurePauseMs };
          throw err;
        },
      )
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }

  async function download(): Promise<Loaded> {
    let res: Response;
    try {
      // Some calendar servers build the file on request (szene-Radar Freiburg: ~13 s); the result is cached.
      res = await fetchFn(feed.url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'text/calendar, text/plain;q=0.8' } });
    } catch {
      throw new ProviderError(`${feed.name} ist gerade nicht erreichbar.`);
    }
    if (!res.ok) throw new ProviderError(`${feed.name} antwortet mit Fehler ${res.status}.`);
    let text: string;
    try {
      text = await readTextCapped(res, MAX_BYTES);
    } catch (err) {
      throw err instanceof TooLarge ? tooLarge() : new ProviderError(`${feed.name} ist gerade nicht erreichbar.`);
    }
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new ProviderError(`${feed.name} liefert keinen gültigen iCal-Kalender.`);
    const loaded = { events: parseIcs(text), checkedAt: new Date().toISOString() };
    cache.set('feed', loaded);
    return loaded;
  }

  return {
    id: `ics:${feed.id}`,
    name: feed.name,
    kind: 'ics',
    // Positions outside the feed's area are rejected, so a search circle that does not touch the area cannot
    // match anything; the margin covers the search centre being rounded to ~1 km.
    covers: (q) =>
      !feed.area ||
      !q.center ||
      !q.radiusKm ||
      distanceKm(q.center, feed.area) <= (feed.area.radiusKm ?? DEFAULT_AREA_RADIUS_KM) + q.radiusKm + 2,
    async fetchEvents(q) {
      const { events, checkedAt } = await load();
      const budget: ExpandBudget = { steps: MAX_STEPS_PER_REQUEST };
      const items = events.flatMap((ev) => icsEventToItems(feed, ev, q.from, q.to, budget));
      return { events: items, truncated: budget.exhausted || events.length >= MAX_EVENTS || undefined, checkedAt };
    },
  };
}
