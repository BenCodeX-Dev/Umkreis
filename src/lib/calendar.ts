import { localDayKey, startOfLocalDay } from '../../shared/time.ts';
import type { EventItem } from '../../shared/types.ts';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateStamp = (d: Date) => localDayKey(d).replace(/-/g, '');

/** Folds long lines (RFC 5545 §3.1); conservative char limit keeps multi-byte umlauts under 75 octets. */
function fold(line: string): string {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 60) parts.push((i ? ' ' : '') + line.slice(i, i + 60));
  return parts.join('\r\n');
}

/** Builds a single-event calendar file with a 1-hour reminder for timed events. */
export function buildIcs(e: EventItem, now = new Date()): string {
  const start = new Date(e.start);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Umkreis//Veranstaltungen//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT'];
  lines.push(`UID:${e.id.replace(/[^\w.:-]/g, '')}@umkreis`, `DTSTAMP:${utcStamp(now)}`);
  if (e.timeKnown) {
    lines.push(`DTSTART:${utcStamp(start)}`);
    if (e.end) lines.push(`DTEND:${utcStamp(new Date(e.end))}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(start)}`);
    const endDay = e.end ? startOfLocalDay(new Date(Date.parse(e.end) - 1), 1) : startOfLocalDay(start, 1);
    lines.push(`DTEND;VALUE=DATE:${dateStamp(endDay)}`);
  }
  lines.push(`SUMMARY:${esc(e.title)}`);
  const where = [e.venue, e.address ?? e.area].filter(Boolean).join(', ');
  if (where) lines.push(`LOCATION:${esc(where)}`);
  const desc = [e.description, e.url && `Originalanzeige: ${e.url}`, `Quelle: ${e.sourceName}`].filter(Boolean).join('\n\n');
  lines.push(`DESCRIPTION:${esc(desc)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.status === 'cancelled') lines.push('STATUS:CANCELLED');
  if (e.timeKnown) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, 'TRIGGER:-PT1H', 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(e: EventItem): void {
  const blob = new Blob([buildIcs(e)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${e.title.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50) || 'veranstaltung'}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
