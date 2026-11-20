import type { GeoPoint } from '../shared/types.ts';
import { TZ, isValidTimeZone, localParts, zonedToUtc } from '../shared/time.ts';

/** Minimal RFC 5545 reader: VEVENTs with DTSTART/DTEND/DURATION, TZID, GEO, and common RRULEs. */

export interface IcsDate {
  utc: Date;
  dateOnly: boolean;
  tz: string;
  local: { y: number; m: number; d: number; h: number; mi: number; s: number };
}

export interface IcsEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  geo?: GeoPoint;
  categories: string[];
  status?: string;
  start: IcsDate;
  durationMs?: number;
  rrule?: string;
  exdates: number[];
  recurrenceId?: number;
}

interface Prop { name: string; params: Record<string, string>; value: string }

const DAY_MS = 86_400_000;

export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else if (line.length) out.push(line);
  }
  return out;
}

function splitOutsideQuotes(s: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = '', quoted = false;
  for (const c of s) {
    if (c === '"') quoted = !quoted;
    if (c === sep && !quoted) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  return parts;
}

export function parseProp(line: string): Prop | null {
  let quoted = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) { colon = i; break; }
  }
  if (colon <= 0) return null;
  const [name, ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

const unescapeText = (v: string) => v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

export function parseIcsDate(value: string, params: Record<string, string>): IcsDate | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (!m[4] || params.VALUE === 'DATE') {
    return { utc: zonedToUtc(y, mo, d, 0, 0, 0, TZ), dateOnly: true, tz: TZ, local: { y, m: mo, d, h: 0, mi: 0, s: 0 } };
  }
  const h = +m[4], mi = +m[5], s = +(m[6] ?? 0);
  if (h > 23 || mi > 59 || s > 60) return null;
  if (m[7]) {
    const utc = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    const p = localParts(utc, TZ);
    return { utc, dateOnly: false, tz: TZ, local: { y: p.y, m: p.m, d: p.d, h: p.h, mi: p.mi, s: p.s } };
  }
  // Floating times and unknown (e.g. Windows) zone names are treated as German local time.
  const tz = params.TZID && isValidTimeZone(params.TZID) ? params.TZID : TZ;
  return { utc: zonedToUtc(y, mo, d, h, mi, s, tz), dateOnly: false, tz, local: { y, m: mo, d, h, mi, s } };
}

export function parseDurationMs(value: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return undefined;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 * 3600 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? undefined : ms || undefined;
}

function buildEvent(props: Prop[]): IcsEvent | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const startProp = get('DTSTART');
  const start = startProp && parseIcsDate(startProp.value, startProp.params);
  if (!start) return null;

  let durationMs: number | undefined;
  const endProp = get('DTEND');
  const end = endProp && parseIcsDate(endProp.value, endProp.params);
  if (end && end.utc > start.utc) durationMs = end.utc.getTime() - start.utc.getTime();
  else if (!endProp) {
    const dur = get('DURATION');
    if (dur) durationMs = parseDurationMs(dur.value);
  }

  let geo: GeoPoint | undefined;
  const geoProp = get('GEO');
  if (geoProp) {
    const [lat, lon] = geoProp.value.split(/[;,]/).map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) geo = { lat, lon };
  }

  const text = (n: string) => {
    const p = get(n);
    const v = p ? unescapeText(p.value).trim() : '';
    return v || undefined;
  };

  const exdates: number[] = [];
  for (const p of props.filter((x) => x.name === 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const d = parseIcsDate(v, p.params);
      if (d) exdates.push(d.utc.getTime());
    }
  }
  const rid = get('RECURRENCE-ID');
  const recurrence = rid && parseIcsDate(rid.value, rid.params);

  return {
    uid: text('UID'),
    summary: text('SUMMARY'),
    description: text('DESCRIPTION'),
    location: text('LOCATION'),
    url: get('URL')?.value.trim(),
    geo,
    categories: props
      .filter((p) => p.name === 'CATEGORIES')
      .flatMap((p) => splitOutsideQuotes(p.value, ',').map((c) => unescapeText(c).trim()))
      .filter(Boolean),
    status: get('STATUS')?.value.trim().toUpperCase(),
    start,
    durationMs,
    rrule: get('RRULE')?.value.trim(),
    exdates,
    recurrenceId: recurrence ? recurrence.utc.getTime() : undefined,
  };
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  const stack: string[] = [];
  let current: Prop[] | null = null;
  for (const line of unfold(text)) {
    const prop = parseProp(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      stack.push(prop.value.trim().toUpperCase());
      if (stack[stack.length - 1] === 'VEVENT') current = [];
    } else if (prop.name === 'END') {
      const closed = stack.pop();
      if (closed === 'VEVENT' && current) {
        const ev = buildEvent(current);
        if (ev) events.push(ev);
        current = null;
      }
    } else if (current && stack[stack.length - 1] === 'VEVENT') {
      current.push(prop);
    }
  }
  // Modified single instances (RECURRENCE-ID) replace the matching occurrence of their series.
  for (const ov of events) {
    if (ov.recurrenceId === undefined || !ov.uid) continue;
    for (const master of events) if (master !== ov && master.uid === ov.uid && master.rrule) master.exdates.push(ov.recurrenceId);
  }
  return events;
}

interface ByDay { ord?: number; wd: number }
interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: number;
  byday?: ByDay[];
  bymonthday?: number[];
  bymonth?: number[];
}

const WD_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const SUPPORTED = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST']);

/** Returns null for rules we cannot expand faithfully — callers then only use DTSTART. */
export function parseRrule(raw: string): Rule | null {
  const parts = new Map<string, string>();
  for (const seg of raw.split(';')) {
    const [k, v] = seg.split('=');
    if (k && v) parts.set(k.toUpperCase(), v.toUpperCase());
  }
  if ([...parts.keys()].some((k) => !SUPPORTED.has(k))) return null;
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const rule: Rule = { freq, interval: Math.max(1, parseInt(parts.get('INTERVAL') ?? '1', 10) || 1) };
  if (parts.has('COUNT')) rule.count = parseInt(parts.get('COUNT')!, 10) || undefined;
  if (parts.has('UNTIL')) {
    const u = parseIcsDate(parts.get('UNTIL')!, {});
    if (!u) return null;
    rule.until = u.utc.getTime() + (u.dateOnly ? DAY_MS - 1 : 0);
  }
  if (parts.has('BYDAY')) {
    const days: ByDay[] = [];
    for (const code of parts.get('BYDAY')!.split(',')) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(code);
      if (!m) return null;
      days.push({ ord: m[1] ? parseInt(m[1], 10) : undefined, wd: WD_CODES[m[2]] });
    }
    rule.byday = days;
  }
  if (parts.has('BYMONTHDAY')) rule.bymonthday = parts.get('BYMONTHDAY')!.split(',').map(Number);
  if (parts.has('BYMONTH')) rule.bymonth = parts.get('BYMONTH')!.split(',').map(Number);
  if (rule.freq === 'YEARLY' && (rule.byday || rule.bymonthday)) return null;
  if (rule.bymonthday?.some((n) => !Number.isInteger(n) || n === 0 || Math.abs(n) > 31)) return null;
  return rule;
}

function matchesRule(rule: Rule, dayIndex: number, y: number, m: number, d: number, wd: number, start: IcsDate, startWd: number): boolean {
  if (rule.bymonth && !rule.bymonth.includes(m)) return false;
  const sl = start.local;
  switch (rule.freq) {
    case 'DAILY':
      return dayIndex % rule.interval === 0 && (!rule.byday || rule.byday.some((b) => b.wd === wd));
    case 'WEEKLY': {
      const week = Math.floor((dayIndex + ((startWd + 6) % 7)) / 7); // weeks start on Monday
      const days = rule.byday ?? [{ wd: startWd }];
      return week % rule.interval === 0 && days.some((b) => b.wd === wd);
    }
    case 'MONTHLY': {
      const months = (y - sl.y) * 12 + (m - sl.m);
      if (months % rule.interval !== 0) return false;
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (rule.bymonthday) return rule.bymonthday.some((n) => (n > 0 ? n === d : dim + 1 + n === d));
      if (rule.byday) {
        return rule.byday.some((b) => {
          if (b.wd !== wd) return false;
          if (!b.ord) return true;
          return b.ord > 0 ? Math.ceil(d / 7) === b.ord : Math.ceil((dim - d + 1) / 7) === -b.ord;
        });
      }
      return d === sl.d;
    }
    case 'YEARLY':
      return (y - sl.y) % rule.interval === 0 && m === sl.m && d === sl.d;
  }
}

export interface Occurrence { start: Date; end?: Date }

/** All occurrences overlapping [from, to). Unsupported rules yield only the first instance. */
export function expandOccurrences(ev: IcsEvent, from: Date, to: Date, max = 100): Occurrence[] {
  const fromMs = from.getTime(), toMs = to.getTime();
  const span = ev.durationMs ?? (ev.start.dateOnly ? DAY_MS : 0);
  const overlaps = (s: number) => (span > 0 ? s < toMs && s + span > fromMs : s >= fromMs && s < toMs);
  const make = (s: number): Occurrence => ({ start: new Date(s), end: ev.durationMs ? new Date(s + ev.durationMs) : undefined });

  const rule = ev.rrule ? parseRrule(ev.rrule) : null;
  if (!rule) {
    const s = ev.start.utc.getTime();
    return overlaps(s) ? [make(s)] : [];
  }

  const sl = ev.start.local;
  const startDay = Date.UTC(sl.y, sl.m - 1, sl.d);
  const startWd = new Date(startDay).getUTCDay();
  // Without COUNT we can jump close to the window instead of walking from DTSTART.
  const skip = rule.count ? 0 : Math.max(0, Math.floor((fromMs - startDay) / DAY_MS) - Math.ceil(span / DAY_MS) - 2);
  const out: Occurrence[] = [];
  let seen = 0;
  for (let i = skip; i - skip < 20_000; i++) {
    const dayMs = startDay + i * DAY_MS;
    if (dayMs > toMs + DAY_MS) break;
    const dt = new Date(dayMs);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate(), wd = dt.getUTCDay();
    if (i !== 0 && !matchesRule(rule, i, y, m, d, wd, ev.start, startWd)) continue;
    const s = (ev.start.dateOnly ? zonedToUtc(y, m, d, 0, 0, 0, ev.start.tz) : zonedToUtc(y, m, d, sl.h, sl.mi, sl.s, ev.start.tz)).getTime();
    if (rule.until !== undefined && s > rule.until) break;
    if (s >= toMs) break;
    seen++;
    if (rule.count !== undefined && seen > rule.count) break;
    if (ev.exdates.includes(s)) continue;
    if (overlaps(s)) {
      out.push(make(s));
      if (out.length >= max) break;
    }
  }
  return out;
}
