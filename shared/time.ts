export const TZ = 'Europe/Berlin';

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts { y: number; m: number; d: number; h: number; mi: number; s: number; weekday: number }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(date: Date, tz = TZ): LocalParts {
  const o: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, weekday: WEEKDAYS[o.weekday] ?? 0 };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

function offsetMs(utcMs: number, tz: string): number {
  const p = localParts(new Date(utcMs), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to the matching UTC instant (DST-aware). */
export function zonedToUtc(y: number, m: number, d: number, h = 0, mi = 0, s = 0, tz = TZ): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const first = guess - offsetMs(guess, tz);
  return new Date(guess - offsetMs(first, tz));
}

export function startOfLocalDay(date: Date, addDays = 0, tz = TZ): Date {
  const p = localParts(date, tz);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + addDays));
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, 0, tz);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of the date in Berlin. */
export function localDayKey(date: Date, tz = TZ): string {
  const p = localParts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
