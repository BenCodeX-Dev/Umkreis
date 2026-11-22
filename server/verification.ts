import { randomBytes } from 'node:crypto';

/** Name of the meta tag a web page uses to show that its owner wants it read by Umkreis. */
export const META_NAME = 'umkreis-verification';

/** A fresh verification code: "umkreis-" plus 20 random lowercase letters and digits. */
export function newVerificationCode(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return `umkreis-${[...randomBytes(20)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/** Bounded and free of `<`, so a page full of broken tags is still scanned in linear time. */
const META_RE = /<meta\b[^<>]{0,2000}>/gi;
const ATTR_RE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
/** Comments and raw-text elements (their content is not markup), and the end of the head. */
const SKIP_RE = /<!--|<(script|style|template|noscript|textarea|title|xmp|iframe|noembed|noframes)\b|<\/head\b|<body\b/gi;

/**
 * The page head without comments, scripts, styles and similar blocks. Text there can come from visitors
 * (comment widgets, embedded JSON), so a `<meta>`-looking string inside it does not count.
 */
function headMarkup(html: string): string {
  const parts: string[] = [];
  const skip = new RegExp(SKIP_RE.source, 'gi');
  let i = 0;
  for (let m = skip.exec(html); m; m = skip.exec(html)) {
    parts.push(html.slice(i, m.index));
    if (m[0] !== '<!--' && !m[1]) return parts.join(''); // </head> or <body>
    const close = m[1] ? new RegExp(`</${m[1]}`, 'gi') : /-->/g;
    close.lastIndex = skip.lastIndex;
    if (!close.exec(html)) return parts.join('');
    i = skip.lastIndex = close.lastIndex;
  }
  parts.push(html.slice(i));
  return parts.join('');
}

/**
 * Whether a line of the calendar itself (name, description – `X-WR-CALDESC`) contains the code. Entries do
 * not count: some public calendars take event submissions from anyone.
 */
function inCalendarProperties(text: string, code: string): boolean {
  let depth = 0;
  for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (/^BEGIN:/i.test(line)) depth++;
    else if (/^END:/i.test(line)) depth = Math.max(0, depth - 1);
    else if (depth === 1 && line.includes(code)) return true;
  }
  return false;
}

/**
 * Whether the owner placed `code`: in an iCal file only in a property of the calendar itself (its description),
 * on a web page only in `<meta name="umkreis-verification" content="…">` in the head.
 */
export function hasVerificationCode(text: string, format: 'ics' | 'web', code: string): boolean {
  if (!/^umkreis-[a-z0-9]{20}$/.test(code)) return false;
  if (format === 'ics') return inCalendarProperties(text, code);
  for (const tag of headMarkup(text).match(META_RE) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    if (attrs.name?.trim().toLowerCase() === META_NAME && attrs.content?.trim() === code) return true;
  }
  return false;
}
