import { inferCategory, isCategoryId } from '../../shared/categories.ts';
import { distanceKm, isInGermanyBounds } from '../../shared/geo.ts';
import { hashString, plainText, safeHttpUrl } from '../../shared/text.ts';
import type { CategoryId, EventItem, GeoPoint, PriceInfo } from '../../shared/types.ts';
import { hasVerificationCode } from '../verification.ts';
import { expandOccurrences, MAX_EVENTS, parseIcs, type ExpandBudget, type IcsEvent } from '../ics.ts';
import { createCachedDownload } from './download.ts';
import { ProviderError, type EventProvider, type FetchFn } from './types.ts';

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  website?: string;
  category?: CategoryId;
  /** Centre of the area the calendar covers; `radiusKm` is how far its events may lie from it. */
  area?: GeoPoint & { label: string; radiusKm?: number };
  /** `ics` (default): an iCal file. `web`: a web page with schema.org events in JSON-LD. */
  format?: 'ics' | 'web';
  /**
   * Set for calendars an organiser connected themselves: the file must keep containing this code (a web page
   * in its `umkreis-verification` meta tag). Removing it withdraws the permission and the events disappear.
   */
  code?: string;
}

export interface FeedOptions {
  ttlMs?: number;
  failurePauseMs?: number;
  headers?: Record<string, string>;
  /** Told on every download whether the verification code was still there. */
  onVerify?: (found: boolean) => void;
}

/** Checks a downloaded file for the organiser's code; throws when it is gone. */
export function requireCode(feed: FeedConfig, text: string, onVerify?: (found: boolean) => void): void {
  if (!feed.code) return;
  const found = hasVerificationCode(text, feed.format ?? 'ics', feed.code);
  onVerify?.(found);
  if (!found) throw new ProviderError(`${feed.name}: Die Freigabe für Umkreis wurde vom Veranstalter entfernt.`);
}

/** Area test shared by feed providers: a search circle that does not touch the feed's area cannot match anything. */
export function feedCovers(feed: FeedConfig) {
  // Positions outside the feed's area are rejected; the margin covers the search centre being rounded to ~1 km.
  return (q: { center?: GeoPoint; radiusKm?: number }) =>
    !feed.area || !q.center || !q.radiusKm || distanceKm(q.center, feed.area) <= (feed.area.radiusKm ?? DEFAULT_AREA_RADIUS_KM) + q.radiusKm + 2;
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

export { readTextCapped } from './download.ts';

const FREE_RE = /eintritt (ist )?frei|freier eintritt|kostenlos|kostenfrei|free admission/i;

export function validateFeed(raw: unknown): FeedConfig | string {
  const f = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (typeof f.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(f.id)) return 'id fehlt oder ungültig (a-z, 0-9, -)';
  if (typeof f.name !== 'string' || !f.name.trim()) return `${f.id}: name fehlt`;
  const url = safeHttpUrl(f.url);
  if (!url) return `${f.id}: url muss mit http(s):// beginnen`;
  const feed: FeedConfig = { id: f.id, name: f.name.trim(), url, website: safeHttpUrl(f.website) };
  if (f.format !== undefined) {
    if (f.format !== 'ics' && f.format !== 'web') return `${f.id}: format muss "ics" oder "web" sein`;
    feed.format = f.format;
  }
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

export function createIcsProvider(feed: FeedConfig, fetchFn: FetchFn = fetch, opts: FeedOptions = {}): EventProvider {
  const load = createCachedDownload({
    name: feed.name,
    url: feed.url,
    fetchFn,
    accept: 'text/calendar, text/plain;q=0.8',
    maxBytes: MAX_BYTES,
    ttlMs: opts.ttlMs ?? 15 * 60_000,
    failurePauseMs: opts.failurePauseMs ?? 5 * 60_000,
    headers: opts.headers,
    parse: (text) => {
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new ProviderError(`${feed.name} liefert keinen gültigen iCal-Kalender.`);
      requireCode(feed, text, opts.onVerify);
      const events = parseIcs(text);
      // The owner's verification code is for Umkreis, not for visitors.
      const code = feed.code;
      return code ? events.map((ev) => (ev.description?.includes(code) ? { ...ev, description: ev.description.replaceAll(code, '').trim() || undefined } : ev)) : events;
    },
  });

  return {
    id: `ics:${feed.id}`,
    name: feed.name,
    kind: 'ics',
    covers: feedCovers(feed),
    async fetchEvents(q) {
      const { data: events, checkedAt } = await load();
      const budget: ExpandBudget = { steps: MAX_STEPS_PER_REQUEST };
      const items = events.flatMap((ev) => icsEventToItems(feed, ev, q.from, q.to, budget));
      return { events: items, truncated: budget.exhausted || events.length >= MAX_EVENTS || undefined, checkedAt };
    },
  };
}
