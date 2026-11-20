import { TZ, localDayKey, localParts, startOfLocalDay } from '../../shared/time.ts';
import type { EventItem } from '../../shared/types.ts';

export type RangeId = 'heute' | 'morgen' | 'wochenende' | '7tage' | '14tage';

export const RANGES: ReadonlyArray<{ id: RangeId; label: string; phrase: string }> = [
  { id: 'heute', label: 'Heute', phrase: 'heute' },
  { id: 'morgen', label: 'Morgen', phrase: 'morgen' },
  { id: 'wochenende', label: 'Wochenende', phrase: 'am Wochenende' },
  { id: '7tage', label: '7 Tage', phrase: 'in den nächsten 7 Tagen' },
  { id: '14tage', label: '14 Tage', phrase: 'in den nächsten 14 Tagen' },
];

/** Day-aligned windows in German time, so the request stays stable all day. */
export function rangeWindow(id: RangeId, now: Date): { from: Date; to: Date } {
  const day = (n: number) => startOfLocalDay(now, n);
  switch (id) {
    case 'heute': return { from: day(0), to: day(1) };
    case 'morgen': return { from: day(1), to: day(2) };
    case '7tage': return { from: day(0), to: day(7) };
    case '14tage': return { from: day(0), to: day(14) };
    case 'wochenende': {
      const wd = localParts(now).weekday; // 0 = Sunday
      if (wd === 0) return { from: day(0), to: day(1) };
      if (wd >= 5) return { from: day(0), to: day(8 - wd) };
      return { from: day(5 - wd), to: day(8 - wd) };
    }
  }
}

const ASSUMED_LENGTH_MS = 3 * 3_600_000;

/** Hides events that are over. Without an end time an event is assumed to last ~3 h; date-only events last all day. */
export function isOver(e: EventItem, now: Date): boolean {
  const start = Date.parse(e.start);
  if (e.end) return Date.parse(e.end) <= now.getTime();
  if (!e.timeKnown) return localDayKey(new Date(start)) < localDayKey(now);
  return start + ASSUMED_LENGTH_MS <= now.getTime();
}

/** Events that started before the window (multi-day) are listed on the window's first day. */
export function dayKeyFor(e: EventItem, windowFrom: Date): string {
  return localDayKey(new Date(Math.max(Date.parse(e.start), windowFrom.getTime())));
}

const dayFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const weekdayFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long' });
const dayMonthFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** Day heading in two parts: a relative or weekday name ("Heute", "Samstag") and the date it stands for. */
export function formatDayHeading(dayKey: string, now: Date): { lead: string; date: string } {
  const [y, m, d] = dayKey.split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  if (dayKey === localDayKey(now)) return { lead: 'Heute', date: dayFmt.format(noon) };
  if (dayKey === localDayKey(startOfLocalDay(now, 1))) return { lead: 'Morgen', date: dayFmt.format(noon) };
  return { lead: weekdayFmt.format(noon), date: dayMonthFmt.format(noon) };
}

/** True when an event began on an earlier day than the day it is listed under (still running). */
export function startedBefore(e: EventItem, dayKey: string): boolean {
  return localDayKey(new Date(e.start)) < dayKey;
}

export function formatTime(e: EventItem): string {
  if (e.allDay) return 'ganztägig';
  if (!e.timeKnown) return 'Uhrzeit offen';
  return timeFmt.format(new Date(e.start));
}

export function formatShortDate(iso: string): string {
  return shortFmt.format(new Date(iso));
}

/** e.g. "bis So., 22.11." for events that end on a later day. */
export function formatUntil(e: EventItem): string | undefined {
  if (!e.end) return undefined;
  const endKey = localDayKey(new Date(Date.parse(e.end) - 1));
  if (endKey === localDayKey(new Date(e.start))) return e.timeKnown ? `bis ${timeFmt.format(new Date(e.end))}` : undefined;
  return `bis ${formatShortDate(new Date(Date.parse(e.end) - 1).toISOString())}`;
}

/** "Samstag, 21. November" in German time. */
export function formatLongDate(iso: string): string {
  return dayFmt.format(new Date(iso));
}
