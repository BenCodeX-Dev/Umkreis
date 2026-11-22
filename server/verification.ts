import { randomBytes } from 'node:crypto';

/** Name of the meta tag a web page uses to show that its owner wants it read by Umkreis. */
export const META_NAME = 'umkreis-verification';

/** A fresh verification code: "umkreis-" plus 20 random lowercase letters and digits. */
export function newVerificationCode(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return `umkreis-${[...randomBytes(20)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

const META_RE = /<meta\b[^>]*>/gi;
const ATTR_RE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/**
 * Whether the owner placed `code`: anywhere in an iCal file (calendar description, or an entry), and on a web
 * page only in `<meta name="umkreis-verification" content="…">` – page text could come from visitors.
 */
export function hasVerificationCode(text: string, format: 'ics' | 'web', code: string): boolean {
  if (!/^umkreis-[a-z0-9]{20}$/.test(code)) return false;
  if (format === 'ics') return text.replace(/\r?\n[ \t]/g, '').includes(code);
  for (const tag of text.match(META_RE) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    if (attrs.name?.trim().toLowerCase() === META_NAME && attrs.content?.trim() === code) return true;
  }
  return false;
}
