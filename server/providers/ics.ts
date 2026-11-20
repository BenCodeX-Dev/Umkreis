import { inferCategory, isCategoryId } from '../../shared/categories.ts';
import { hashString, plainText, safeHttpUrl } from '../../shared/text.ts';
import type { CategoryId, EventItem, GeoPoint, PriceInfo } from '../../shared/types.ts';
import { TtlCache } from '../cache.ts';
import { expandOccurrences, parseIcs, type IcsEvent } from '../ics.ts';
import { ProviderError, type EventProvider, type FetchFn } from './types.ts';

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  website?: string;
  category?: CategoryId;
  area?: GeoPoint & { label: string };
}

const MAX_BYTES = 5 * 1024 * 1024;
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
    feed.area = { label: a.label, lat: a.lat, lon: a.lon };
  }
  return feed;
}

export function icsEventToItems(feed: FeedConfig, ev: IcsEvent, from: Date, to: Date): EventItem[] {
  const title = plainText(ev.summary, 160);
  if (!title) return [];
  const description = plainText(ev.description);
  const category = inferCategory(`${ev.categories.join(' ')} ${title}`) ?? feed.category ?? inferCategory(description ?? '') ?? 'sonstiges';
  const price: PriceInfo | undefined = description && FREE_RE.test(description) ? { currency: 'EUR', free: true, fromText: true } : undefined;
  const eventUrl = safeHttpUrl(ev.url);
  const baseId = hashString(ev.uid ?? `${title}|${ev.start.utc.toISOString()}`);

  return expandOccurrences(ev, from, to).map((occ) => ({
    id: `ics:${feed.id}:${baseId}:${occ.start.getTime()}`,
    source: `ics:${feed.id}`,
    sourceName: feed.name,
    isDemo: false,
    title,
    start: occ.start.toISOString(),
    end: occ.end?.toISOString(),
    timeKnown: !ev.start.dateOnly,
    allDay: ev.start.dateOnly || undefined,
    venue: plainText(ev.location, 160),
    area: feed.area?.label,
    location: ev.geo ?? (feed.area ? { lat: feed.area.lat, lon: feed.area.lon } : undefined),
    locationApprox: !ev.geo && !!feed.area,
    category,
    price,
    description,
    url: eventUrl ?? feed.website,
    urlLabel: eventUrl ? 'Originalanzeige' : feed.website ? 'Zum Veranstaltungskalender' : undefined,
    status: ev.status === 'CANCELLED' ? 'cancelled' : undefined,
  }));
}

export function createIcsProvider(feed: FeedConfig, fetchFn: FetchFn = fetch, ttlMs = 15 * 60_000): EventProvider {
  const cache = new TtlCache<IcsEvent[]>(ttlMs, 1);
  async function load(): Promise<IcsEvent[]> {
    const hit = cache.get('feed');
    if (hit) return hit;
    let res: Response;
    try {
      res = await fetchFn(feed.url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'text/calendar, text/plain;q=0.8' } });
    } catch {
      throw new ProviderError(`${feed.name} ist gerade nicht erreichbar.`);
    }
    if (!res.ok) throw new ProviderError(`${feed.name} antwortet mit Fehler ${res.status}.`);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new ProviderError(`${feed.name}: Kalenderdatei ist zu groß.`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new ProviderError(`${feed.name}: Kalenderdatei ist zu groß.`);
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new ProviderError(`${feed.name} liefert keinen gültigen iCal-Kalender.`);
    const events = parseIcs(text);
    cache.set('feed', events);
    return events;
  }

  return {
    id: `ics:${feed.id}`,
    name: feed.name,
    kind: 'ics',
    async fetchEvents(q) {
      const events = await load();
      return { events: events.flatMap((ev) => icsEventToItems(feed, ev, q.from, q.to)) };
    },
  };
}
