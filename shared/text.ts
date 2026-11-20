/** Returns the URL only if it is an absolute http(s) URL; blocks javascript:, data: etc. */
export function safeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Strips tags, collapses whitespace and shortens to `max` characters. */
export function plainText(raw: unknown, max = 400): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function normalizeForSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/** Small stable string hash (djb2) for building ids. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
