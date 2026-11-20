import type { CategoryId } from './types.ts';

export const CATEGORIES: ReadonlyArray<{ id: CategoryId; label: string }> = [
  { id: 'konzert', label: 'Konzerte' },
  { id: 'party', label: 'Partys' },
  { id: 'markt', label: 'Märkte' },
  { id: 'festival', label: 'Feste & Festivals' },
  { id: 'community', label: 'Gemeinschaft' },
  { id: 'kultur', label: 'Kultur & Bühne' },
  { id: 'sport', label: 'Sport & Bewegung' },
  { id: 'familie', label: 'Familie & Kinder' },
  { id: 'sonstiges', label: 'Sonstiges' },
];

const IDS = new Set<string>(CATEGORIES.map((c) => c.id));

export function isCategoryId(v: unknown): v is CategoryId {
  return typeof v === 'string' && IDS.has(v);
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? 'Sonstiges';
}

/** Ordered keyword rules; the first match wins. Used only for sources without a structured category. */
const RULES: ReadonlyArray<[CategoryId, RegExp]> = [
  ['festival', /festival|stadtfest|stra(ß|ss)enfest|weinfest|volksfest|dorffest|kirmes|\bkerb\b|\bkerwe\b|open[- ]?air|\bfest\b/i],
  ['markt', /markt(?!platz)|märkte|basar|bazaar|trödel|\bmarket\b/i],
  ['party', /party|\bclub\b|\bdj\b|\brave\b|disco|tanznacht|tanzabend|ü30|ue30/i],
  ['konzert', /konzert|concert|live[- ]?musik|\bband\b|\bchor\b|orchester|\bjazz\b|recital|\bgig\b/i],
  ['familie', /kinder|famili|\bkids\b|puppentheater|märchen/i],
  ['sport', /\blauf|marathon|turnier|fu(ß|ss)ball|\bsport|yoga|radtour|wanderung|spieltag/i],
  ['kultur', /theater|ausstellung|museum|lesung|\bkino\b|\bfilm|vernissage|\boper\b|ballett|kabarett|comedy|führung|vortrag/i],
  ['community', /treff|stammtisch|verein|ehrenamt|nachbarschaft|workshop|repair[- ]?caf|meetup|begegnung|gemeinde|bürger|offene/i],
];

export function inferCategory(text: string): CategoryId | undefined {
  for (const [id, re] of RULES) if (re.test(text)) return id;
  return undefined;
}
