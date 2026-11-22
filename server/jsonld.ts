import { TZ, zonedToUtc } from '../shared/time.ts';

/**
 * Reads schema.org events from the JSON-LD blocks of a web page – the markup sites add so search engines
 * can list their events. Only what the page states is taken; nothing is guessed.
 */

export type Obj = Record<string, unknown>;

export interface SchemaDate {
  at: Date;
  dateOnly: boolean;
}

const MAX_BLOCKS = 100;
const MAX_NODES = 5000;
const MAX_DEPTH = 6;

/** schema.org types that describe something people can attend. */
const EVENT_TYPES = new Set([
  'Event', 'BusinessEvent', 'ChildrensEvent', 'ComedyEvent', 'DanceEvent', 'EducationEvent', 'EventSeries',
  'ExhibitionEvent', 'Festival', 'FoodEvent', 'Hackathon', 'LiteraryEvent', 'MusicEvent', 'SaleEvent',
  'ScreeningEvent', 'SocialEvent', 'SportsEvent', 'TheaterEvent', 'VisualArtsEvent',
]);

const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** "schema:MusicEvent", "https://schema.org/MusicEvent" → "MusicEvent". */
export function typeNames(node: Obj): string[] {
  return list(node['@type'])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, ''));
}

export const isEventNode = (node: Obj): boolean => typeNames(node).some((t) => EVENT_TYPES.has(t));

const ENTITIES: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', '#39': "'", '#34': '"' };

/** Some sites HTML-escape the JSON or leave raw line breaks inside strings; both are repaired once. */
function parseLenient(text: string): unknown {
  const body = text.trim().replace(/^<!--|-->$/g, '').replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, '').trim();
  try {
    return JSON.parse(body);
  } catch {
    const repaired = body.replace(/&(quot|amp|apos|lt|gt|#39|#34);/g, (_, e: string) => ENTITIES[e]).replace(/[\r\n\t]+/g, ' ');
    try {
      return JSON.parse(repaired);
    } catch {
      return undefined;
    }
  }
}

/** The parsed contents of every `<script type="application/ld+json">` block (unparseable ones are skipped). */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (let m = re.exec(html); m && out.length < MAX_BLOCKS; m = re.exec(html)) {
    const parsed = parseLenient(m[1]);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

/**
 * Event nodes anywhere in the blocks: top level, arrays, `@graph`, item lists. A series or festival that
 * lists its single dates (`subEvent`) is replaced by those dates.
 */
export function findEvents(blocks: unknown[]): Obj[] {
  const found: Obj[] = [];
  let visited = 0;
  const walk = (v: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || visited > MAX_NODES) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const node = obj(v);
    if (!node) return;
    visited++;
    if (isEventNode(node)) {
      const subs = list(node.subEvent).map(obj).filter((s): s is Obj => !!s && isEventNode(s));
      if (subs.length) subs.forEach((s) => walk(s, depth + 1));
      else found.push(node);
      return;
    }
    walk(node['@graph'], depth + 1);
    for (const el of list(node.itemListElement)) {
      const e = obj(el);
      walk(e && !isEventNode(e) && e.item !== undefined ? e.item : el, depth + 1);
    }
  };
  walk(blocks, 0);
  return found;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * schema.org dates: "2026-11-28", "2026-11-28T19:00", "2026-11-28T19:00:00+01:00". Without an offset the time
 * is read as German local time, which is what sites in Germany mean. Impossible dates are rejected.
 */
export function parseSchemaDate(raw: unknown): SchemaDate | null {
  if (typeof raw !== 'string') return null;
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (m[4] === undefined) return { at: zonedToUtc(y, mo, d, 0, 0, 0, TZ), dateOnly: true };
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (h > 24 || mi > 59 || s > 59) return null;
  if (m[7]) {
    const off = m[7].toUpperCase() === 'Z' ? 'Z' : m[7].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    const at = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${String(s).padStart(2, '0')}${off}`);
    return Number.isNaN(at.getTime()) ? null : { at, dateOnly: false };
  }
  return { at: zonedToUtc(y, mo, d, h, mi, s, TZ), dateOnly: false };
}

/** A number given as number or text ("12,50", "12.50"). */
export function schemaNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
