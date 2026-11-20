import { inferCategory } from '../../shared/categories.ts';
import { geohash } from '../../shared/geo.ts';
import { zonedToUtc } from '../../shared/time.ts';
import { plainText, safeHttpUrl } from '../../shared/text.ts';
import type { CategoryId, EventItem, EventStatus, PriceInfo } from '../../shared/types.ts';
import { ProviderError, type EventProvider, type FetchFn, type ProviderQuery } from './types.ts';

const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
const PAGE_SIZE = 100;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** Ticketmaster wants "YYYY-MM-DDTHH:mm:ssZ" without milliseconds. */
export const tmDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

function mapCategory(e: Obj, title: string): CategoryId {
  if (/festival/i.test(title)) return 'festival';
  const c = obj(Array.isArray(e.classifications) ? e.classifications[0] : undefined);
  const segment = str(obj(c?.segment)?.name) ?? '';
  const genre = str(obj(c?.genre)?.name) ?? '';
  if (/family|famil|kinder/i.test(genre) || c?.family === true) return 'familie';
  switch (segment) {
    case 'Music': return 'konzert';
    case 'Sports': return 'sport';
    case 'Arts & Theatre':
    case 'Film': return 'kultur';
    default: return inferCategory(`${title} ${genre}`) ?? 'sonstiges';
  }
}

function parseLocalStart(start: Obj): { iso: string; timeKnown: boolean } | undefined {
  const date = str(start.localDate);
  const dm = date && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const noTime = start.timeTBA === true || start.noSpecificTime === true;
  const dateTime = str(start.dateTime);
  if (dateTime && !noTime && !Number.isNaN(Date.parse(dateTime))) return { iso: new Date(dateTime).toISOString(), timeKnown: true };
  if (!dm) return undefined;
  const tm = !noTime && str(start.localTime) ? /^(\d{2}):(\d{2})/.exec(str(start.localTime)!) : null;
  const d = zonedToUtc(+dm[1], +dm[2], +dm[3], tm ? +tm[1] : 0, tm ? +tm[2] : 0);
  return { iso: d.toISOString(), timeKnown: !!tm };
}

/** Converts one raw Discovery API event; returns null for unusable records (no title, no date). */
export function normalizeTicketmasterEvent(raw: unknown): EventItem | null {
  const e = obj(raw);
  const id = str(e?.id);
  const title = str(e?.name);
  const dates = obj(e?.dates);
  const startObj = obj(dates?.start);
  if (!e || !id || !title || !startObj || startObj.dateTBA === true || startObj.dateTBD === true) return null;
  const start = parseLocalStart(startObj);
  if (!start) return null;

  const venue = obj(Array.isArray(obj(e._embedded)?.venues) ? (obj(e._embedded)!.venues as unknown[])[0] : undefined);
  const lat = num(obj(venue?.location)?.latitude);
  const lon = num(obj(venue?.location)?.longitude);
  const city = str(obj(venue?.city)?.name);
  const line1 = str(obj(venue?.address)?.line1);
  const postal = str(venue?.postalCode);

  let price: PriceInfo | undefined;
  const pr = obj(Array.isArray(e.priceRanges) ? e.priceRanges[0] : undefined);
  const min = num(pr?.min), max = num(pr?.max);
  if (pr && (min !== undefined || max !== undefined) && !(min === 0 && max === 0)) {
    price = { currency: str(pr.currency) ?? 'EUR', min, max };
  }

  const endObj = obj(dates?.end);
  const endIso = endObj && endObj.approximate !== true ? str(endObj.dateTime) : undefined;
  const statusCode = str(obj(dates?.status)?.code);
  const status: EventStatus | undefined =
    statusCode === 'cancelled' || statusCode === 'postponed' || statusCode === 'rescheduled' ? statusCode : undefined;

  return {
    id: `tm:${id}`,
    source: 'ticketmaster',
    sourceName: 'Ticketmaster',
    isDemo: false,
    title,
    start: start.iso,
    end: endIso && !Number.isNaN(Date.parse(endIso)) ? new Date(endIso).toISOString() : undefined,
    timeKnown: start.timeKnown,
    venue: str(venue?.name),
    area: city,
    address: [line1, [postal, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || undefined,
    location: lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)
      ? { lat, lon } : undefined,
    category: mapCategory(e, title),
    price,
    description: plainText(e.info ?? e.description ?? e.pleaseNote),
    url: safeHttpUrl(e.url),
    urlLabel: 'Bei Ticketmaster ansehen',
    status,
  };
}

export function createTicketmasterProvider(apiKey: string, fetchFn: FetchFn = fetch): EventProvider {
  return {
    id: 'ticketmaster',
    name: 'Ticketmaster',
    kind: 'ticketmaster',
    async fetchEvents(q: ProviderQuery) {
      const params = new URLSearchParams({
        apikey: apiKey,
        countryCode: 'DE',
        locale: '*',
        size: String(PAGE_SIZE),
        sort: 'date,asc',
        startDateTime: tmDate(q.from),
        endDateTime: tmDate(q.to),
      });
      if (q.center && q.radiusKm) {
        params.set('geoPoint', geohash(q.center, 6));
        params.set('radius', String(Math.ceil(q.radiusKm)));
        params.set('unit', 'km');
      }
      if (q.text) params.set('keyword', q.text);

      let res: Response;
      try {
        res = await fetchFn(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
      } catch {
        throw new ProviderError('Ticketmaster ist gerade nicht erreichbar.');
      }
      if (res.status === 401 || res.status === 403) throw new ProviderError('Ticketmaster: API-Schlüssel ungültig oder nicht freigeschaltet.');
      if (res.status === 429) throw new ProviderError('Ticketmaster: Tageskontingent oder Ratenlimit erreicht. Bitte später erneut versuchen.');
      if (!res.ok) throw new ProviderError(`Ticketmaster antwortet mit Fehler ${res.status}.`);

      let body: Obj | undefined;
      try {
        body = obj(await res.json());
      } catch {
        throw new ProviderError('Ticketmaster hat eine unlesbare Antwort geliefert.');
      }
      const list = obj(body?._embedded)?.events;
      const events = (Array.isArray(list) ? list : []).map(normalizeTicketmasterEvent).filter((x): x is EventItem => x !== null);
      const total = num(obj(body?.page)?.totalElements) ?? 0;
      return { events, truncated: total > PAGE_SIZE, checkedAt: new Date().toISOString() };
    },
  };
}
