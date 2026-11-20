import { normalizeForSearch } from '../../shared/text.ts';
import { localDayKey, startOfLocalDay, TZ } from '../../shared/time.ts';
import type { EventItem } from '../../shared/types.ts';
import { formatTime } from './dates.ts';

/** Saved entries older than this are flagged: the organiser may have changed them since. */
export const STALE_AFTER_MS = 24 * 3_600_000;

export type Freshness =
  | { kind: 'unknown' }
  | { kind: 'checked'; at: Date; stale: boolean };

export function freshness(e: EventItem, now: Date): Freshness {
  const t = e.checkedAt ? Date.parse(e.checkedAt) : NaN;
  if (Number.isNaN(t)) return { kind: 'unknown' };
  return { kind: 'checked', at: new Date(t), stale: now.getTime() - t > STALE_AFTER_MS };
}

const clock = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: 'numeric', month: 'long' });

/** "gerade eben", "vor 12 Min.", "heute, 14:32", "gestern, 09:10", "18. November, 14:32". */
export function formatCheckedAt(at: Date, now: Date): string {
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const day = localDayKey(at);
  if (day === localDayKey(now)) return `heute, ${clock.format(at)} Uhr`;
  if (day === localDayKey(startOfLocalDay(now, -1))) return `gestern, ${clock.format(at)} Uhr`;
  return `${dayMonth.format(at)}, ${clock.format(at)} Uhr`;
}

/** Details the source did not provide. Price is left out: "Preis unbekannt" is already shown everywhere. */
export function missingDetails(e: EventItem): string[] {
  const out: string[] = [];
  if (!e.timeKnown && !e.allDay) out.push('Uhrzeit');
  if (!e.venue && !e.address && !e.area) out.push('Ort');
  // A rejected position was given but is not used – the position note says so; it is not "missing".
  if (!e.location && !e.locationRejected) out.push('Kartenposition');
  else if (e.locationApprox && !e.locationRejected) out.push('genaue Kartenposition');
  if (!e.url) out.push('Originalanzeige');
  return out;
}

/**
 * Where an outbound link leads, shown before it is opened so a listing pointing somewhere unexpected
 * stands out. International names stay in their xn-- form, which makes look-alike letters visible.
 */
export function linkTarget(url: string): { host: string; insecure: boolean } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return { host: u.hostname.replace(/^www\./, ''), insecure: u.protocol === 'http:' };
  } catch {
    return null;
  }
}

const key = (s: string) => normalizeForSearch(s).replace(/\W+/g, '');

/**
 * Finds listings of what looks like the same event (same title, same day in Germany) where
 * another source states a different time, venue or cancellation. Only events in `events` are
 * compared, so this cannot see conflicts with listings outside the current results.
 */
export function findConflicts(events: EventItem[]): Map<string, string[]> {
  const groups = new Map<string, EventItem[]>();
  for (const e of events) {
    const k = `${key(e.title)}|${localDayKey(new Date(e.start))}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }

  const out = new Map<string, string[]>();
  for (const group of groups.values()) {
    const sources = new Set(group.map((e) => e.source));
    if (sources.size < 2) continue;
    for (const e of group) {
      const notes: string[] = [];
      for (const src of sources) {
        if (src === e.source) continue;
        const others = group.filter((o) => o.source === src);
        const name = others[0].sourceName;
        const timed = others.filter((o) => o.timeKnown && !o.allDay);
        if (e.timeKnown && !e.allDay && timed.length > 0 && !timed.some((o) => o.start === e.start)) {
          notes.push(`${name} nennt ${[...new Set(timed.map(formatTime))].join(' / ')} Uhr`);
        }
        const venues = others.filter((o) => o.venue);
        if (e.venue && venues.length > 0 && !venues.some((o) => key(o.venue!) === key(e.venue!))) {
          notes.push(`${name} nennt als Ort „${venues[0].venue}“`);
        }
        const cancelled = e.status === 'cancelled';
        if (others.some((o) => (o.status === 'cancelled') !== cancelled)) {
          notes.push(cancelled ? `${name} führt sie nicht als abgesagt` : `${name} meldet sie als abgesagt`);
        }
      }
      if (notes.length) out.set(e.id, notes);
    }
  }
  return out;
}
