import { categoryLabel } from '../../shared/categories.ts';
import { distanceKm } from '../../shared/geo.ts';
import { normalizeForSearch } from '../../shared/text.ts';
import type { CategoryId, EventItem, GeoPoint } from '../../shared/types.ts';
import { dayKeyFor, isOver } from './dates.ts';

export type SortId = 'zeit' | 'entfernung' | 'interessen';

export interface FilterOptions {
  categories: CategoryId[];
  text: string;
  sort: SortId;
  interests: CategoryId[];
  home?: GeoPoint;
  now: Date;
  windowFrom: Date;
}

export interface RankedEvent {
  event: EventItem;
  distanceKm?: number;
  /** Human-readable reasons why the event is highlighted. */
  reasons: string[];
  matchesInterest: boolean;
}

export interface DayGroup { dayKey: string; items: RankedEvent[] }

export function matchesText(e: EventItem, text: string): boolean {
  const needle = normalizeForSearch(text.trim());
  if (!needle) return true;
  return normalizeForSearch([e.title, e.venue, e.area, e.description, categoryLabel(e.category)].filter(Boolean).join(' ')).includes(needle);
}

export function rankEvents(events: EventItem[], o: FilterOptions): RankedEvent[] {
  return events
    .filter((e) => !isOver(e, o.now))
    .filter((e) => o.categories.length === 0 || o.categories.includes(e.category))
    .filter((e) => matchesText(e, o.text))
    .map((e) => {
      const km = o.home && e.location ? distanceKm(o.home, e.location) : undefined;
      const matchesInterest = o.interests.includes(e.category);
      // Highlighting is driven only by the user's chosen interests; extra reasons just explain it.
      const reasons: string[] = [];
      if (matchesInterest) {
        reasons.push(`passt zu deinem Interesse „${categoryLabel(e.category)}“`);
        if (km !== undefined && km < 2 && !e.locationApprox) {
          reasons.push('ganz in der Nähe (unter 2 km)');
        }
        if (e.price?.free) reasons.push('kostenlos');
      }
      return { event: e, distanceKm: km, reasons, matchesInterest };
    });
}

function compare(sort: SortId) {
  const byTime = (a: RankedEvent, b: RankedEvent) => a.event.start.localeCompare(b.event.start);
  return (a: RankedEvent, b: RankedEvent) => {
    if (sort === 'entfernung') return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || byTime(a, b);
    if (sort === 'interessen') return Number(b.matchesInterest) - Number(a.matchesInterest) || byTime(a, b);
    return byTime(a, b);
  };
}

/** Groups by German calendar day (chronological); the chosen sort applies within each day. */
export function groupByDay(items: RankedEvent[], sort: SortId, windowFrom: Date): DayGroup[] {
  const map = new Map<string, RankedEvent[]>();
  for (const it of items) {
    const key = dayKeyFor(it.event, windowFrom);
    const list = map.get(key);
    if (list) list.push(it);
    else map.set(key, [it]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, list]) => ({ dayKey, items: list.sort(compare(sort)) }));
}
