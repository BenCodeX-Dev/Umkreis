import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { isCategoryId } from '../shared/categories.ts';
import { isInGermanyBounds } from '../shared/geo.ts';
import { plainText } from '../shared/text.ts';
import type { CategoryId } from '../shared/types.ts';
import { parseIcs } from './ics.ts';
import { readTextCapped } from './providers/download.ts';
import { createIcsProvider, icsEventToItems, MAX_STEPS_PER_REQUEST, type FeedConfig } from './providers/ics.ts';
import type { EventProvider, FetchFn } from './providers/types.ts';
import { createWebProvider, parseEventPage } from './providers/web.ts';
import { hasVerificationCode, newVerificationCode } from './verification.ts';

/**
 * "Kalender verbinden": an organiser registers the address of their iCal calendar or event page once. It is
 * read only after they put a verification code into it (proof they control it), and only while the code stays
 * there. On a public server an operator also approves each source (`npm run sources`).
 */

export type ConnectStatus = 'pending' | 'waiting' | 'active' | 'withdrawn' | 'blocked';

export interface ConnectedSource {
  id: string;
  url: string;
  /** Host name without `www.` and trailing dot, shown to visitors and used to block a whole site. */
  site: string;
  name: string;
  area: { label: string; lat: number; lon: number };
  category?: CategoryId;
  format?: 'ics' | 'web';
  code: string;
  /** SHA-256 of the management key; the key itself stays with the organiser. */
  keyHash: string;
  status: ConnectStatus;
  createdAt: string;
  checkedAt?: string;
  approvedAt?: string;
  /** Set by the operator (`block-site`): the whole site and its subdomains are blocked, not just this address. */
  blockSite?: boolean;
}

/** What the organiser sees about their source. */
export type SourceView = Pick<ConnectedSource, 'id' | 'url' | 'site' | 'name' | 'format' | 'code' | 'status' | 'createdAt' | 'checkedAt'> & { area: string };

export class ConnectError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ConnectOptions {
  file: string;
  /** `auto`: a verified source goes live at once (fine for a private server). `manual`: an operator approves it. */
  approval: 'auto' | 'manual';
  fetchFn: FetchFn;
  userAgent: string;
  now?: () => number;
  maxPending?: number;
  maxSources?: number;
}

const PENDING_TTL_MS = 48 * 3600_000;
const CHECK_INTERVAL_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;
/** Same limit as the regular reader of web pages, so a page that passes the check can also be read later. */
const WEB_MAX_BYTES = 3 * 1024 * 1024;
const LOOKAHEAD_MS = 62 * 86_400_000;
const STATUSES: ConnectStatus[] = ['pending', 'waiting', 'active', 'withdrawn', 'blocked'];

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** Normalises what an organiser pastes; returns an error text for addresses that cannot be used. */
export function normalizeSourceUrl(raw: unknown): { url: string; site: string } | string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 500) return 'Bitte die Adresse des Kalenders oder der Veranstaltungsseite angeben.';
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return 'Das ist keine gültige Adresse.';
  }
  if (u.protocol === 'http:') return 'Bitte die https-Adresse angeben (Umkreis liest nur verschlüsselt übertragene Seiten).';
  if (u.protocol !== 'https:') return 'Nur https-Adressen sind möglich.';
  if (u.username || u.password) return 'Adressen mit Zugangsdaten sind nicht erlaubt.';
  if (u.port) return 'Adressen mit eigenem Port sind nicht erlaubt.';
  // One canonical spelling per host (lowercase, punycode, no trailing dot), so blocks can't be dodged by `verein.example.`.
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || host.split('.').some((l) => !l) || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'Bitte eine öffentliche Adresse mit Domainnamen angeben.';
  }
  u.hostname = host;
  u.hash = '';
  return { url: u.toString(), site: host.replace(/^www\./, '') };
}

function validStored(raw: unknown): ConnectedSource | null {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!s || typeof s.id !== 'string' || typeof s.keyHash !== 'string' || typeof s.code !== 'string' || typeof s.name !== 'string') return null;
  const norm = normalizeSourceUrl(s.url);
  const a = s.area as Record<string, unknown> | undefined;
  if (typeof norm === 'string' || !a || typeof a.label !== 'string' || typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
  if (!STATUSES.includes(s.status as ConnectStatus) || typeof s.createdAt !== 'string') return null;
  return {
    id: s.id,
    url: norm.url,
    site: norm.site,
    name: s.name,
    area: { label: a.label, lat: a.lat, lon: a.lon },
    category: isCategoryId(s.category) ? s.category : undefined,
    format: s.format === 'ics' || s.format === 'web' ? s.format : undefined,
    code: s.code,
    keyHash: s.keyHash,
    status: s.status as ConnectStatus,
    createdAt: s.createdAt,
    checkedAt: typeof s.checkedAt === 'string' ? s.checkedAt : undefined,
    approvedAt: typeof s.approvedAt === 'string' ? s.approvedAt : undefined,
    blockSite: s.blockSite === true ? true : undefined,
  };
}

/** The list on disk. Reads tolerate a missing or damaged file; writes replace it atomically. */
export function createSourceStore(file: string) {
  let sources: ConnectedSource[] = [];
  let stamp = '';

  function reload(): ConnectedSource[] {
    let next: string;
    try {
      const st = statSync(file);
      next = `${st.mtimeMs}|${st.size}`;
    } catch {
      next = 'missing';
    }
    if (next === stamp) return sources;
    stamp = next;
    if (next === 'missing') return (sources = []);
    try {
      const list: unknown = JSON.parse(readFileSync(file, 'utf8'));
      sources = (Array.isArray(list) ? list : []).map(validStored).filter((s): s is ConnectedSource => !!s);
    } catch {
      console.error(`${path.basename(file)} ist beschädigt – verbundene Kalender sind deaktiviert, bis die Datei repariert ist.`);
      sources = [];
    }
    return sources;
  }

  /** Re-reads the file (another process may have changed it), applies `fn`, writes the result. */
  function mutate<T>(fn: (list: ConnectedSource[]) => T): T {
    const list = [...reload()];
    const out = fn(list);
    if (!existsSync(path.dirname(file))) mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    sources = list;
    stamp = '';
    reload();
    return out;
  }

  return { reload, mutate, file };
}

export function viewOf(s: ConnectedSource): SourceView {
  return { id: s.id, url: s.url, site: s.site, name: s.name, area: s.area.label, format: s.format, code: s.code, status: s.status, createdAt: s.createdAt, checkedAt: s.checkedAt };
}

/** Sites the operator blocked as a whole (`block-site`): no sign-ups, checks or events from there or any subdomain. */
export function blockedSites(list: ConnectedSource[]): Set<string> {
  return new Set(list.filter((x) => x.status === 'blocked' && x.blockSite).map((x) => x.site));
}

/** True if `site` or one of its parent domains is in `blocked`. */
export function siteBlocked(site: string, blocked: Set<string>): boolean {
  for (let d = site; ; d = d.slice(d.indexOf('.') + 1)) {
    if (blocked.has(d)) return true;
    if (!d.includes('.')) return false;
  }
}

/** The entry itself is blocked, or its site is. */
function isBlocked(s: ConnectedSource, list: ConnectedSource[]): boolean {
  return s.status === 'blocked' || siteBlocked(s.site, blockedSites(list));
}

export function createConnectRegistry(o: ConnectOptions) {
  const store = createSourceStore(o.file);
  const now = o.now ?? Date.now;
  const lastCheck = new Map<string, number>();
  const built = new Map<string, { sig: string; provider: EventProvider }>();
  const headers = { 'User-Agent': o.userAgent };

  function authorized(id: unknown, key: unknown): ConnectedSource {
    const s = typeof id === 'string' ? store.reload().find((x) => x.id === id) : undefined;
    const given = typeof key === 'string' ? Buffer.from(hashKey(key)) : Buffer.alloc(0);
    if (!s || given.length !== s.keyHash.length || !timingSafeEqual(given, Buffer.from(s.keyHash))) {
      throw new ConnectError(404, 'Diese Anmeldung gibt es nicht (mehr).');
    }
    return s;
  }

  const update = (id: string, patch: Partial<ConnectedSource>) =>
    store.mutate((list) => {
      const i = list.findIndex((x) => x.id === id);
      // A block by the operator always wins over automatic status changes.
      if (i >= 0 && list[i].status !== 'blocked') list[i] = { ...list[i], ...patch };
    });

  function submit(body: unknown): { source: SourceView; key: string } {
    const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    // Hidden form field: people leave it empty, simple bots fill it in.
    if (typeof b.website === 'string' && b.website.trim()) throw new ConnectError(400, 'Ungültige Anfrage.');
    if (b.consent !== true) throw new ConnectError(400, 'Bitte bestätigen, dass du diese Termine veröffentlichen darfst.');
    const norm = normalizeSourceUrl(b.url);
    if (typeof norm === 'string') throw new ConnectError(400, norm);
    const name = plainText(b.name, 80);
    if (!name || name.length < 2) throw new ConnectError(400, 'Bitte den Namen des Veranstalters angeben.');
    const label = plainText(b.areaLabel, 80);
    const lat = typeof b.lat === 'number' ? b.lat : NaN, lon = typeof b.lon === 'number' ? b.lon : NaN;
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lon) || !isInGermanyBounds({ lat, lon })) {
      throw new ConnectError(400, 'Bitte den Ort in Deutschland wählen, an dem die Veranstaltungen stattfinden.');
    }
    if (b.category !== undefined && b.category !== '' && !isCategoryId(b.category)) throw new ConnectError(400, 'Unbekannte Kategorie.');

    const key = randomBytes(24).toString('base64url');
    const created = store.mutate((list) => {
      const t = now();
      // Unconfirmed sign-ups expire, so nobody can reserve an address for good.
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].status === 'pending' && t - Date.parse(list[i].createdAt) > PENDING_TTL_MS) list.splice(i, 1);
      }
      if (siteBlocked(norm.site, blockedSites(list))) throw new ConnectError(403, 'Diese Website ist für Umkreis gesperrt.');
      if (list.some((x) => x.url === norm.url && x.status === 'blocked')) throw new ConnectError(403, 'Diese Adresse ist für Umkreis gesperrt.');
      if (list.some((x) => x.url === norm.url && x.status !== 'pending')) throw new ConnectError(409, 'Diese Adresse ist schon verbunden.');
      if (list.filter((x) => x.status === 'pending').length >= (o.maxPending ?? 100)) {
        throw new ConnectError(503, 'Gerade sind zu viele Anmeldungen offen. Bitte später erneut versuchen.');
      }
      if (list.filter((x) => x.status !== 'pending').length >= (o.maxSources ?? 500)) {
        throw new ConnectError(503, 'Dieser Server nimmt gerade keine weiteren Kalender an.');
      }
      const s: ConnectedSource = {
        id: randomBytes(9).toString('base64url'),
        url: norm.url,
        site: norm.site,
        name,
        area: { label, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 },
        category: isCategoryId(b.category) ? b.category : undefined,
        code: newVerificationCode(),
        keyHash: hashKey(key),
        status: 'pending',
        createdAt: new Date(t).toISOString(),
      };
      list.push(s);
      return s;
    });
    return { source: viewOf(created), key };
  }

  const feedOf = (s: ConnectedSource, format: 'ics' | 'web'): FeedConfig => ({
    id: `c-${s.id}`,
    name: s.name,
    url: s.url,
    website: format === 'web' ? s.url : undefined,
    category: s.category,
    area: s.area,
    format,
    code: s.code,
  });

  /** Downloads the address once, finds out what it is, and whether the code is in place. */
  async function check(id: unknown, key: unknown) {
    const s = authorized(id, key);
    if (isBlocked(s, store.reload())) throw new ConnectError(403, 'Diese Adresse ist für Umkreis gesperrt.');
    const t = now();
    if (t - (lastCheck.get(s.id) ?? -Infinity) < CHECK_INTERVAL_MS) throw new ConnectError(429, 'Bitte ein paar Sekunden warten und dann erneut prüfen.');
    lastCheck.set(s.id, t);

    let text: string;
    try {
      const res = await o.fetchFn(s.url, { signal: AbortSignal.timeout(20_000), headers: { ...headers, Accept: 'text/calendar, text/html;q=0.9, */*;q=0.5' } });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new ConnectError(502, `Die Adresse antwortet mit Fehler ${res.status}.`);
      }
      text = await readTextCapped(res, MAX_BYTES);
    } catch (err) {
      if (err instanceof ConnectError) throw err;
      throw new ConnectError(502, 'Die Adresse ist nicht erreichbar (nur öffentliche https-Adressen, höchstens 3 Weiterleitungen, bis 5 MB).');
    }

    const format: 'ics' | 'web' | null = /BEGIN:VCALENDAR/i.test(text) ? 'ics' : /<(?:!doctype html|html|head|body)\b/i.test(text) ? 'web' : null;
    if (!format) throw new ConnectError(422, 'Unter dieser Adresse liegt weder ein iCal-Kalender noch eine Webseite.');
    if (format === 'web' && Buffer.byteLength(text) > WEB_MAX_BYTES) throw new ConnectError(422, 'Die Seite ist zu groß (höchstens 3 MB). Nutze eine schlankere Terminseite oder den iCal-Link.');
    const feed = feedOf(s, format);
    const from = new Date(t), to = new Date(t + LOOKAHEAD_MS);
    // The (cheap, linear) code check comes first: unverified content is never parsed for events.
    const codeFound = hasVerificationCode(text, format, s.code);
    let upcoming = 0;
    if (codeFound && format === 'ics') {
      const budget = { steps: MAX_STEPS_PER_REQUEST };
      upcoming = parseIcs(text).reduce((n, ev) => n + icsEventToItems(feed, ev, from, to, budget).length, 0);
    } else if (codeFound) {
      upcoming = parseEventPage(feed, text, s.url).items.filter((e) => Date.parse(e.end ?? e.start) >= t && Date.parse(e.start) < to.getTime()).length;
    }
    const checkedAt = new Date(t).toISOString();

    let status = s.status;
    let message: string;
    if (!codeFound) {
      if (status === 'active' || status === 'waiting') status = 'withdrawn';
      message = format === 'ics'
        ? 'Der Code steht noch nicht in der Beschreibung des Kalenders. Trag ihn dort ein (nicht bei einem einzelnen Termin), warte, bis dein Kalenderdienst die Datei aktualisiert, und prüfe dann erneut.'
        : `Der Code steht noch nicht im <meta>-Tag der Seite. Füge ihn wie angegeben in den <head> ein und prüfe dann erneut.`;
    } else if (format === 'web' && upcoming === 0 && !/application\/ld\+json/i.test(text)) {
      message = 'Der Code ist da, aber die Seite enthält keine Veranstaltungsdaten im schema.org-Format. Nutze stattdessen den iCal-Link deines Kalenders oder ein Kalender-Plugin, das schema.org-Daten ausgibt.';
    } else {
      status = s.approvedAt || o.approval === 'auto' ? 'active' : 'waiting';
      message = status === 'active'
        ? `Verbunden. ${upcoming} kommende Termine gefunden; sie erscheinen ab jetzt in Umkreis. Lass den Code stehen – entfernst du ihn, verschwinden die Termine wieder.`
        : `Bestätigt. ${upcoming} kommende Termine gefunden. Der Betreiber dieses Servers schaltet neue Kalender von Hand frei; danach erscheinen sie automatisch.`;
    }
    const blockedMeanwhile = store.mutate((list) => {
      const i = list.findIndex((x) => x.id === s.id);
      if (i < 0) return false;
      // The download can take a while; an operator block made in the meantime must stay in place.
      if (isBlocked(list[i], list)) return true;
      list[i] = { ...list[i], status, format, checkedAt, approvedAt: status === 'active' ? (list[i].approvedAt ?? checkedAt) : list[i].approvedAt };
      // Whoever proves control first keeps the address; other unconfirmed sign-ups for it are dropped.
      if (codeFound) for (let j = list.length - 1; j >= 0; j--) if (j !== i && list[j].url === s.url && list[j].status === 'pending') list.splice(j, 1);
      return false;
    });
    if (blockedMeanwhile) throw new ConnectError(403, 'Diese Adresse ist für Umkreis gesperrt.');
    const fresh = store.reload().find((x) => x.id === s.id);
    return { source: viewOf(fresh ?? { ...s, status, format, checkedAt }), result: { codeFound, format, upcoming, message } };
  }

  /** Providers for every live source; rebuilt only when a source changes. */
  function providers(): EventProvider[] {
    const out: EventProvider[] = [];
    const live = new Set<string>();
    const list = store.reload();
    const blocked = blockedSites(list);
    for (const s of list) {
      if (s.status !== 'active' || !s.format || siteBlocked(s.site, blocked)) continue;
      const sig = `${s.url}|${s.code}|${s.format}|${s.name}|${s.area.lat},${s.area.lon}|${s.category ?? ''}`;
      live.add(s.id);
      let b = built.get(s.id);
      if (!b || b.sig !== sig) {
        const opts = { headers, onVerify: (found: boolean) => void (found ? undefined : update(s.id, { status: 'withdrawn', checkedAt: new Date(now()).toISOString() })) };
        const feed = feedOf(s, s.format);
        b = { sig, provider: s.format === 'ics' ? createIcsProvider(feed, o.fetchFn, opts) : createWebProvider(feed, o.fetchFn, opts) };
        built.set(s.id, b);
      }
      out.push(b.provider);
    }
    for (const id of built.keys()) if (!live.has(id)) built.delete(id);
    return out;
  }

  return {
    submit,
    check,
    get: (id: unknown, key: unknown) => ({ source: viewOf(authorized(id, key)) }),
    remove(id: unknown, key: unknown) {
      const s = authorized(id, key);
      if (s.status === 'blocked') throw new ConnectError(403, 'Gesperrte Einträge kann nur der Betreiber entfernen.');
      const removed = store.mutate((list) => {
        const i = list.findIndex((x) => x.id === s.id);
        if (i < 0 || list[i].status === 'blocked') return false;
        list.splice(i, 1);
        return true;
      });
      if (!removed && store.reload().some((x) => x.id === s.id)) throw new ConnectError(403, 'Gesperrte Einträge kann nur der Betreiber entfernen.');
      return { removed: true };
    },
    providers,
    count: () => store.reload().filter((s) => s.status === 'active').length,
    approval: o.approval,
  };
}

export type ConnectRegistry = ReturnType<typeof createConnectRegistry>;
