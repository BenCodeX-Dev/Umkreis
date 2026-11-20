import type { EventItem, GeoPoint } from '../../shared/types.ts';

/** Events that share one map position (same venue, or a calendar's area centre) become one pin. */
export interface MapSpot {
  key: string;
  point: GeoPoint;
  events: EventItem[];
  /** At least one entry here is only the calendar's area centre, not the venue. */
  approx: boolean;
  demo: boolean;
}

export const spotKey = (p: GeoPoint) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

export function groupSpots(events: EventItem[]): MapSpot[] {
  const spots = new Map<string, MapSpot>();
  for (const e of events) {
    if (!e.location) continue;
    const key = spotKey(e.location);
    const s = spots.get(key);
    if (s) {
      s.events.push(e);
      s.approx ||= !!e.locationApprox;
      s.demo ||= e.isDemo;
    } else {
      spots.set(key, { key, point: e.location, events: [e], approx: !!e.locationApprox, demo: e.isDemo });
    }
  }
  return [...spots.values()];
}
