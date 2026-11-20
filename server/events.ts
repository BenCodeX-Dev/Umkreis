import { distanceKm } from '../shared/geo.ts';
import { normalizeForSearch } from '../shared/text.ts';
import type { EventItem, EventsResponse, SourceMode, SourceStatus } from '../shared/types.ts';
import { TtlCache } from './cache.ts';
import { ProviderError, type EventProvider, type ProviderQuery, type ProviderResult } from './providers/types.ts';

export const MAX_EVENTS = 300;

export function queryKey(q: ProviderQuery): string {
  return [q.scope, q.center?.lat, q.center?.lon, q.radiusKm, q.from.toISOString(), q.to.toISOString(), q.text ?? ''].join('|');
}

export function overlapsWindow(e: EventItem, from: Date, to: Date): boolean {
  const s = Date.parse(e.start);
  const end = e.end ? Date.parse(e.end) : s;
  return s < to.getTime() && Math.max(end, s) >= from.getTime();
}

const dedupeKey = (e: EventItem) => `${normalizeForSearch(e.title).replace(/\W+/g, '')}|${e.start.slice(0, 16)}`;
const venueKey = (e: EventItem) => (e.venue ? normalizeForSearch(e.venue).replace(/\W+/g, '') : '');

/** Queries all providers in parallel, tolerating partial failure, then filters, de-duplicates and sorts. */
export function createEventService(providers: EventProvider[], mode: SourceMode, cacheTtlMs = 5 * 60_000) {
  const cache = new TtlCache<ProviderResult>(cacheTtlMs, 300);
  /** Identical queries arriving while one is running share it instead of each calling the source again. */
  const running = new Map<string, Promise<ProviderResult>>();

  function fromProvider(p: EventProvider, q: ProviderQuery): Promise<ProviderResult> {
    const key = `${p.id}|${queryKey(q)}`;
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    const pending = running.get(key);
    if (pending) return pending;
    const job = p
      .fetchEvents(q)
      .then((res) => {
        cache.set(key, res);
        return res;
      })
      .finally(() => running.delete(key));
    running.set(key, job);
    return job;
  }

  return async function collect(q: ProviderQuery): Promise<EventsResponse & { allFailed: boolean }> {
    const settled = await Promise.allSettled(providers.map((p) => fromProvider(p, q)));
    const sources: SourceStatus[] = [];
    let truncated = false;
    const seenIds = new Set<string>();
    /** dedupe key → venue keys already listed under it */
    const seenKeys = new Map<string, string[]>();
    const needle = q.text ? normalizeForSearch(q.text) : '';
    const events: EventItem[] = [];

    settled.forEach((r, i) => {
      const p = providers[i];
      if (r.status === 'rejected') {
        const message = r.reason instanceof ProviderError ? r.reason.message : `${p.name} konnte nicht geladen werden.`;
        if (!(r.reason instanceof ProviderError)) console.error(`[${p.id}]`, r.reason instanceof Error ? r.reason.message : r.reason);
        sources.push({ id: p.id, name: p.name, kind: p.kind, ok: false, count: 0, message });
        return;
      }
      truncated ||= !!r.value.truncated;
      let count = 0;
      for (const e of r.value.events) {
        if (!overlapsWindow(e, q.from, q.to)) continue;
        if (q.center && q.radiusKm !== undefined) {
          if (!e.location || distanceKm(q.center, e.location) > q.radiusKm) continue;
        }
        if (needle && !normalizeForSearch(`${e.title} ${e.venue ?? ''} ${e.area ?? ''} ${e.description ?? ''}`).includes(needle)) continue;
        if (seenIds.has(e.id)) continue;
        // Same title and start from two sources is one event – unless both name different venues.
        // Then both stay, so the client can flag the conflict instead of silently picking one.
        const k = dedupeKey(e);
        const v = venueKey(e);
        const venues = seenKeys.get(k);
        if (venues && (!v || venues.includes(v) || venues.includes(''))) continue;
        seenIds.add(e.id);
        seenKeys.set(k, [...(venues ?? []), v]);
        events.push(r.value.checkedAt && !e.checkedAt ? { ...e, checkedAt: r.value.checkedAt } : e);
        count++;
      }
      sources.push({ id: p.id, name: p.name, kind: p.kind, ok: true, count, checkedAt: r.value.checkedAt });
    });

    events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'de'));
    if (events.length > MAX_EVENTS) truncated = true;
    return {
      mode,
      events: events.slice(0, MAX_EVENTS),
      sources,
      truncated,
      allFailed: providers.length > 0 && sources.every((s) => !s.ok),
    };
  };
}
