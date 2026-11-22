import { inferCategory } from '../../shared/categories.ts';
import { hashString, plainText, safeHttpUrl } from '../../shared/text.ts';
import type { CategoryId, EventItem, EventStatus, GeoPoint, PriceInfo } from '../../shared/types.ts';
import { findEvents, jsonLdBlocks, parseSchemaDate, schemaNumber, typeNames, type Obj } from '../jsonld.ts';
import { createCachedDownload } from './download.ts';
import { feedCovers, plausibleGeo, requireCode, type FeedConfig, type FeedOptions } from './ics.ts';
import { ProviderError, type EventProvider, type FetchFn } from './types.ts';

const MAX_BYTES = 3 * 1024 * 1024;
/** Events taken from one page – a calendar page rarely lists more; the rest is cut and reported. */
const MAX_PAGE_EVENTS = 1000;

const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const text = (v: unknown, max?: number) => plainText(typeof v === 'number' ? String(v) : v, max);

function resolveUrl(raw: unknown, base: string): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    return safeHttpUrl(new URL(raw.trim(), base).toString());
  } catch {
    return undefined;
  }
}

function geoOf(place: Obj | undefined): GeoPoint | undefined {
  const g = obj(first(place?.geo));
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
  const lat = num(g?.latitude), lon = num(g?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
}

function addressOf(place: Obj | undefined): string | undefined {
  const a = place?.address;
  if (typeof a === 'string') return text(a, 200);
  const p = obj(first(a));
  if (!p) return undefined;
  const town = [text(p.postalCode, 10), text(p.addressLocality, 80)].filter(Boolean).join(' ');
  return [text(p.streetAddress, 120), town].filter(Boolean).join(', ') || undefined;
}

function priceOf(node: Obj): PriceInfo | undefined {
  if (node.isAccessibleForFree === true || node.isAccessibleForFree === 'true') return { currency: 'EUR', free: true };
  const offers = (Array.isArray(node.offers) ? node.offers : [node.offers]).map(obj).filter((o): o is Obj => !!o);
  const amounts: number[] = [];
  let currency: string | undefined;
  for (const o of offers) {
    // A price without a currency is not shown – it would be a guess.
    const c = typeof o.priceCurrency === 'string' && /^[A-Z]{3}$/.test(o.priceCurrency) ? o.priceCurrency : undefined;
    if (!c || (currency && c !== currency)) continue;
    for (const v of [o.price, o.lowPrice, o.highPrice]) {
      const n = schemaNumber(v);
      if (n !== undefined) {
        amounts.push(n);
        currency = c;
      }
    }
  }
  if (!currency || amounts.length === 0) return undefined;
  const min = Math.min(...amounts), max = Math.max(...amounts);
  return max === 0 ? { currency, free: true } : { currency, min, max: max > min ? max : undefined };
}

/** Categories the page itself states through its schema.org type. */
const TYPE_CATEGORY: Record<string, CategoryId> = {
  MusicEvent: 'konzert', Festival: 'festival', SportsEvent: 'sport', ChildrensEvent: 'familie', SaleEvent: 'markt',
  SocialEvent: 'community', TheaterEvent: 'kultur', ComedyEvent: 'kultur', DanceEvent: 'kultur', ScreeningEvent: 'kultur',
  LiteraryEvent: 'kultur', ExhibitionEvent: 'kultur', VisualArtsEvent: 'kultur',
};

function statusOf(node: Obj): EventStatus | undefined {
  const s = typeof node.eventStatus === 'string' ? node.eventStatus : '';
  if (/EventCancelled$/i.test(s)) return 'cancelled';
  if (/EventPostponed$/i.test(s)) return 'postponed';
  if (/EventRescheduled$/i.test(s)) return 'rescheduled';
  return undefined;
}

/** One schema.org event as shown in Umkreis, or null when it lacks a name or a valid start, or is online only. */
export function schemaEventToItem(feed: FeedConfig, node: Obj, pageUrl: string): EventItem | null {
  const title = text(node.name, 160);
  const start = parseSchemaDate(node.startDate);
  if (!title || !start) return null;
  if (/OnlineEventAttendanceMode$/i.test(String(node.eventAttendanceMode ?? ''))) return null;
  let end = parseSchemaDate(node.endDate) ?? undefined;
  if (end && end.at < start.at) end = undefined;
  // A date-only end means "through that day".
  const endAt = end ? new Date(end.at.getTime() + (end.dateOnly ? 86_400_000 - 1 : 0)) : undefined;

  const place = obj(first(node.location));
  const online = place && typeNames(place).includes('VirtualLocation');
  const claimed = online ? undefined : geoOf(place);
  const geo = plausibleGeo(feed, claimed);
  const description = text(node.description);
  const eventUrl = resolveUrl(node.url, pageUrl);
  const typed = typeNames(node).map((t) => TYPE_CATEGORY[t]).find(Boolean);

  return {
    id: `web:${feed.id}:${hashString(typeof node['@id'] === 'string' ? node['@id'] : `${eventUrl ?? ''}|${title}`)}:${start.at.getTime()}`,
    source: `web:${feed.id}`,
    sourceName: feed.name,
    title,
    start: start.at.toISOString(),
    end: endAt?.toISOString(),
    timeKnown: !start.dateOnly,
    allDay: start.dateOnly || undefined,
    venue: online ? undefined : typeof node.location === 'string' ? text(node.location, 160) : text(place?.name, 160),
    address: online ? undefined : addressOf(place),
    area: feed.area?.label,
    location: geo ?? (feed.area ? { lat: feed.area.lat, lon: feed.area.lon } : undefined),
    locationApprox: !geo && !!feed.area,
    locationRejected: (!!claimed && !geo) || undefined,
    category: typed ?? inferCategory(title) ?? feed.category ?? inferCategory(description ?? '') ?? 'sonstiges',
    price: priceOf(node),
    description,
    url: eventUrl ?? pageUrl,
    urlLabel: eventUrl ? 'Originalanzeige' : 'Zur Veranstaltungsseite',
    status: statusOf(node),
  };
}

/** Events of a page: JSON-LD blocks → event nodes → items. */
export function parseEventPage(feed: FeedConfig, html: string, pageUrl: string): { items: EventItem[]; truncated: boolean } {
  const nodes = findEvents(jsonLdBlocks(html));
  const items = nodes.slice(0, MAX_PAGE_EVENTS).map((n) => schemaEventToItem(feed, n, pageUrl)).filter((e): e is EventItem => !!e);
  return { items, truncated: nodes.length > MAX_PAGE_EVENTS };
}

/** A web page whose events are marked up with schema.org (format "web" in feeds.json, or connected by its organiser). */
export function createWebProvider(feed: FeedConfig, fetchFn: FetchFn = fetch, opts: FeedOptions = {}): EventProvider {
  const load = createCachedDownload({
    name: feed.name,
    url: feed.url,
    fetchFn,
    accept: 'text/html, application/xhtml+xml;q=0.9',
    maxBytes: MAX_BYTES,
    ttlMs: opts.ttlMs ?? 30 * 60_000,
    failurePauseMs: opts.failurePauseMs ?? 5 * 60_000,
    headers: opts.headers,
    parse: (html) => {
      requireCode(feed, html, opts.onVerify);
      const page = parseEventPage(feed, html, feed.url);
      if (page.items.length === 0 && !/application\/ld\+json/i.test(html)) {
        throw new ProviderError(`${feed.name}: Die Seite enthält keine Veranstaltungsdaten (schema.org).`);
      }
      return page;
    },
  });

  return {
    id: `web:${feed.id}`,
    name: feed.name,
    kind: 'web',
    covers: feedCovers(feed),
    async fetchEvents() {
      const { data, checkedAt } = await load();
      return { events: data.items, truncated: data.truncated || undefined, checkedAt };
    },
  };
}
