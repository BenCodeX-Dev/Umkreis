import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiHandler } from '../server/api.ts';
import { loadServerConfig } from '../server/config.ts';
import { ConnectError, createConnectRegistry, normalizeSourceUrl } from '../server/connect.ts';
import { findEvents, jsonLdBlocks, parseSchemaDate, schemaNumber } from '../server/jsonld.ts';
import type { FeedConfig } from '../server/providers/ics.ts';
import { ProviderError } from '../server/providers/types.ts';
import { createWebProvider, parseEventPage, schemaEventToItem } from '../server/providers/web.ts';
import { withRedirects } from '../server/publicFetch.ts';
import { hasVerificationCode, newVerificationCode } from '../server/verification.ts';

const CODE = 'umkreis-abcdefghijkmnpqrstuv';
const feed: FeedConfig = { id: 'kh', name: 'Kulturhaus', url: 'https://kulturhaus.example/termine', area: { label: 'Darmstadt', lat: 49.872, lon: 8.651 } };
const page = (ld: unknown, head = '') => `<!doctype html><html><head>${head}<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
const meta = (code: string) => `<meta name="umkreis-verification" content="${code}">`;

describe('verification code', () => {
  it('creates well-formed, different codes', () => {
    const a = newVerificationCode(), b = newVerificationCode();
    expect(a).toMatch(/^umkreis-[a-z0-9]{20}$/);
    expect(a).not.toBe(b);
  });

  it('finds the code in the calendar description, also when the line is folded', () => {
    expect(hasVerificationCode(`BEGIN:VCALENDAR\r\nX-WR-CALDESC:Freigabe ${CODE}\r\nEND:VCALENDAR`, 'ics', CODE)).toBe(true);
    expect(hasVerificationCode(`BEGIN:VCALENDAR\r\nX-WR-CALDESC:Freigabe umkreis-abcdefghij\r\n kmnpqrstuv\r\nEND:VCALENDAR`, 'ics', CODE)).toBe(true);
    expect(hasVerificationCode('BEGIN:VCALENDAR', 'ics', CODE)).toBe(false);
  });

  it('ignores the code in single entries – some calendars take entries from anyone', () => {
    const entry = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Fest\r\nDESCRIPTION:${CODE}\r\nBEGIN:VALARM\r\nDESCRIPTION:${CODE}\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    expect(hasVerificationCode(entry, 'ics', CODE)).toBe(false);
    expect(hasVerificationCode(`X-WR-CALDESC:${CODE}`, 'ics', CODE)).toBe(false);
  });

  it('accepts the code on a web page only in its meta tag', () => {
    expect(hasVerificationCode(`<head>${meta(CODE)}</head>`, 'web', CODE)).toBe(true);
    expect(hasVerificationCode(`<meta content='${CODE}' NAME='umkreis-verification'/>`, 'web', CODE)).toBe(true);
    expect(hasVerificationCode(`<meta name=umkreis-verification content=${CODE}>`, 'web', CODE)).toBe(true);
    // Visitors can put text on many pages (comments, guest books) – that must not count.
    expect(hasVerificationCode(`<p>Kommentar: ${CODE}</p>`, 'web', CODE)).toBe(false);
    expect(hasVerificationCode(`<meta name="description" content="${CODE}">`, 'web', CODE)).toBe(false);
    expect(hasVerificationCode(`<meta name="umkreis-verification" content="${CODE}">`, 'web', 'nicht-gueltig')).toBe(false);
  });

  it('counts only real meta elements in the head', () => {
    const tag = meta(CODE);
    expect(hasVerificationCode(`<html><head><title>T</title>${tag}</head><body></body></html>`, 'web', CODE)).toBe(true);
    // Text a visitor could get onto the page: comments, embedded data, form fields, or anywhere in the body.
    expect(hasVerificationCode(`<head><!-- ${tag} --></head>`, 'web', CODE)).toBe(false);
    expect(hasVerificationCode(`<head><script>var c = '${tag}';</script></head>`, 'web', CODE)).toBe(false);
    expect(hasVerificationCode(`<head><SCRIPT type="application/json">["${tag}"]</SCRIPT></head>`, 'web', CODE)).toBe(false);
    expect(hasVerificationCode(`<head><title>${tag}</title></head>`, 'web', CODE)).toBe(false);
    expect(hasVerificationCode(`<head></head><body><div>${tag}</div></body>`, 'web', CODE)).toBe(false);
    expect(hasVerificationCode(`<head><textarea>${tag}`, 'web', CODE)).toBe(false);
  });

  it('stays fast on crafted pages', () => {
    const started = performance.now();
    const junk = '<meta name="umkreis-verification" '.repeat(60_000) + '<script type="application/ld+json" '.repeat(60_000);
    expect(hasVerificationCode(junk, 'web', CODE)).toBe(false);
    expect(jsonLdBlocks(junk)).toEqual([]);
    expect(jsonLdBlocks('<script type=application/ld+json>'.repeat(60_000))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('schema.org JSON-LD', () => {
  it('finds events in arrays, @graph, item lists and series', () => {
    const html =
      page([{ '@type': 'Organization' }, { '@type': 'MusicEvent', name: 'A' }]) +
      page({ '@context': 'https://schema.org', '@graph': [{ '@type': 'schema:TheaterEvent', name: 'B' }] }) +
      page({ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { '@type': 'Event', name: 'C' } }] }) +
      page({ '@type': 'EventSeries', name: 'Reihe', subEvent: [{ '@type': 'Event', name: 'D1' }, { '@type': 'Event', name: 'D2' }] });
    expect(findEvents(jsonLdBlocks(html)).map((e) => e.name)).toEqual(['A', 'B', 'C', 'D1', 'D2']);
  });

  it('repairs HTML-escaped JSON and skips broken blocks', () => {
    const html = `<script type="application/ld+json">{&quot;@type&quot;:&quot;Event&quot;,&quot;name&quot;:&quot;Lesung&quot;}</script><script type="application/ld+json">{kaputt</script>`;
    expect(findEvents(jsonLdBlocks(html)).map((e) => e.name)).toEqual(['Lesung']);
  });

  it('reads dates as stated, German local time when no offset is given, and rejects impossible ones', () => {
    expect(parseSchemaDate('2026-11-28T19:00:00+01:00')?.at.toISOString()).toBe('2026-11-28T18:00:00.000Z');
    expect(parseSchemaDate('2026-07-01T19:00')?.at.toISOString()).toBe('2026-07-01T17:00:00.000Z');
    expect(parseSchemaDate('2026-11-28')).toEqual({ at: new Date('2026-11-27T23:00:00.000Z'), dateOnly: true });
    expect(parseSchemaDate('2026-02-30')).toBeNull();
    expect(parseSchemaDate('morgen')).toBeNull();
    expect(schemaNumber('12,50')).toBe(12.5);
    expect(schemaNumber('-3')).toBeUndefined();
  });
});

describe('web events', () => {
  const base = { '@type': 'MusicEvent', name: 'Jazzabend', startDate: '2026-12-05T20:00:00+01:00' };

  it('takes only what the page states', () => {
    const e = schemaEventToItem(feed, {
      ...base,
      url: '/termine/jazz',
      endDate: '2026-12-05T23:00:00+01:00',
      location: { '@type': 'Place', name: 'Kulturhaus', address: { '@type': 'PostalAddress', streetAddress: 'Hauptstr. 1', postalCode: '64283', addressLocality: 'Darmstadt' }, geo: { latitude: '49.87', longitude: '8.65' } },
      offers: { '@type': 'Offer', price: '15', priceCurrency: 'EUR' },
      eventStatus: 'https://schema.org/EventPostponed',
    }, feed.url)!;
    expect(e).toMatchObject({
      title: 'Jazzabend', start: '2026-12-05T19:00:00.000Z', end: '2026-12-05T22:00:00.000Z', timeKnown: true,
      venue: 'Kulturhaus', address: 'Hauptstr. 1, 64283 Darmstadt', location: { lat: 49.87, lon: 8.65 }, locationApprox: false,
      price: { currency: 'EUR', min: 15 }, status: 'postponed', url: 'https://kulturhaus.example/termine/jazz', category: 'konzert',
    });
  });

  it('shows no price without currency, approximates the place, and drops online-only events', () => {
    const e = schemaEventToItem(feed, { ...base, offers: { price: '10' }, location: { '@type': 'Place', geo: { latitude: 52.5, longitude: 13.4 } } }, feed.url)!;
    expect(e.price).toBeUndefined();
    expect(e).toMatchObject({ location: { lat: 49.872, lon: 8.651 }, locationApprox: true, locationRejected: true, urlLabel: 'Zur Veranstaltungsseite' });
    expect(schemaEventToItem(feed, { ...base, isAccessibleForFree: true }, feed.url)?.price).toEqual({ currency: 'EUR', free: true });
    expect(schemaEventToItem(feed, { ...base, eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode' }, feed.url)).toBeNull();
    expect(schemaEventToItem(feed, { '@type': 'Event', name: 'Ohne Datum' }, feed.url)).toBeNull();
  });

  it('reads a page only while the owner code is in place', async () => {
    let html = page([base], meta(CODE));
    const onVerify = vi.fn();
    const p = createWebProvider({ ...feed, format: 'web', code: CODE }, (async () => new Response(html)) as unknown as typeof fetch, { ttlMs: 1, failurePauseMs: 1, onVerify });
    const q = { scope: 'local' as const, center: { lat: 49.87, lon: 8.65 }, radiusKm: 10, from: new Date('2026-12-01T00:00:00Z'), to: new Date('2026-12-10T00:00:00Z') };
    expect((await p.fetchEvents(q)).events.map((e) => e.title)).toEqual(['Jazzabend']);
    expect(onVerify).toHaveBeenLastCalledWith(true);
    html = page([base]);
    await new Promise((r) => setTimeout(r, 5));
    await expect(p.fetchEvents(q)).rejects.toBeInstanceOf(ProviderError);
    expect(onVerify).toHaveBeenLastCalledWith(false);
  });

  it('caps very long pages', () => {
    const many = Array.from({ length: 1005 }, (_, i) => ({ ...base, name: `E${i}` }));
    const r = parseEventPage(feed, page(many), feed.url);
    expect(r.items).toHaveLength(1000);
    expect(r.truncated).toBe(true);
  });
});

describe('source addresses', () => {
  it('normalises webcal links and refuses unsafe addresses', () => {
    expect(normalizeSourceUrl('webcal://www.verein.example/kalender.ics#x')).toEqual({ url: 'https://www.verein.example/kalender.ics', site: 'verein.example' });
    expect(normalizeSourceUrl('https://Verein.EXAMPLE./k.ics')).toEqual({ url: 'https://verein.example/k.ics', site: 'verein.example' });
    expect(normalizeSourceUrl('https://bücher.example/k.ics')).toEqual({ url: 'https://xn--bcher-kva.example/k.ics', site: 'xn--bcher-kva.example' });
    for (const bad of ['https://verein..example/k.ics', 'https://./', 'http://verein.example/k.ics', 'https://user:pw@verein.example/', 'https://verein.example:8443/', 'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://nas.local/', 'ftp://verein.example/', 'kein link', '']) {
      expect(typeof normalizeSourceUrl(bad)).toBe('string');
    }
  });

  it('follows redirects only to other https addresses, and only a few times', async () => {
    const hops: string[] = [];
    const to = (location: string) => new Response(null, { status: 302, headers: { location } });
    const fake = (async (u: string) => {
      hops.push(u);
      if (u.endsWith('/a')) return to('/b');
      if (u.endsWith('/b')) return new Response('ok');
      if (u.endsWith('/http')) return to('http://x.example/');
      if (u.endsWith('/port')) return to('https://x.example:22/');
      return to('/loop');
    }) as unknown as typeof fetch;
    const f = withRedirects(fake, 3);
    expect(await (await f('https://x.example/a')).text()).toBe('ok');
    expect(hops).toEqual(['https://x.example/a', 'https://x.example/b']);
    await expect(f('https://x.example/http')).rejects.toThrow(/nicht erlaubte/);
    await expect(f('https://x.example/port')).rejects.toThrow(/nicht erlaubte/);
    await expect(f('https://x.example/loop')).rejects.toThrow(/Zu viele/);
  });
});

describe('connect registry', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  function setup(approval: 'auto' | 'manual' = 'auto') {
    dir = mkdtempSync(path.join(tmpdir(), 'umkreis-connect-'));
    const file = path.join(dir, 'sources.json');
    const files = new Map<string, string>();
    let t = Date.parse('2026-12-01T10:00:00Z');
    const fetchFn = vi.fn(async (u: string) => (files.has(u) ? new Response(files.get(u)) : new Response('weg', { status: 404 })));
    const reg = createConnectRegistry({ file, approval, fetchFn: fetchFn as unknown as typeof fetch, userAgent: 'test', now: () => t });
    return { reg, file, files, fetchFn, tick: (ms: number) => (t += ms) };
  }
  const form = { url: 'https://verein.example/kalender.ics', name: 'Turnverein', areaLabel: 'Darmstadt', lat: 49.872, lon: 8.651, consent: true };
  const ics = (code = '') => `BEGIN:VCALENDAR\r\nX-WR-CALDESC:${code}\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Vereinsfest\r\nDTSTART:20261205T150000Z\r\nDTEND:20261205T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

  it('rejects incomplete or automated sign-ups', () => {
    const { reg } = setup();
    expect(() => reg.submit({ ...form, website: 'spam' })).toThrow(ConnectError);
    expect(() => reg.submit({ ...form, consent: false })).toThrow(/bestätigen/);
    expect(() => reg.submit({ ...form, url: 'http://verein.example/k.ics' })).toThrow(/https/);
    expect(() => reg.submit({ ...form, lat: 48.86, lon: 2.35 })).toThrow(/Deutschland/);
    expect(() => reg.submit({ ...form, name: '' })).toThrow(/Namen/);
  });

  it('goes live only after the code is in the calendar, and stops when it is removed', async () => {
    const { reg, files, file, tick } = setup('auto');
    const { source, key } = reg.submit(form);
    expect(source.status).toBe('pending');
    expect(readFileSync(file, 'utf8')).not.toContain(key); // only the hash is stored
    files.set(form.url, ics());
    const first = await reg.check(source.id, key);
    expect(first.result).toMatchObject({ codeFound: false, format: 'ics', upcoming: 0 });
    expect(first.source.status).toBe('pending');
    expect(reg.providers()).toHaveLength(0);

    await expect(reg.check(source.id, key)).rejects.toMatchObject({ status: 429 });
    tick(31_000);
    files.set(form.url, ics(`Freigabe ${source.code}`));
    const second = await reg.check(source.id, key);
    expect(second.source.status).toBe('active');
    expect(reg.count()).toBe(1);
    const [p] = reg.providers();
    const q = { scope: 'local' as const, center: { lat: 49.87, lon: 8.65 }, radiusKm: 10, from: new Date('2026-12-01T00:00:00Z'), to: new Date('2026-12-10T00:00:00Z') };
    expect((await p.fetchEvents(q)).events.map((e) => e.title)).toEqual(['Vereinsfest']);

    files.set(form.url, ics());
    const fresh = reg.providers()[0];
    expect(fresh).toBe(p); // reused, not rebuilt on every search
    tick(31_000);
    const third = await reg.check(source.id, key);
    expect(third.source.status).toBe('withdrawn');
    expect(reg.providers()).toHaveLength(0);
  });

  it('does not show the code to visitors', async () => {
    const { reg, files, tick } = setup('auto');
    const { source, key } = reg.submit(form);
    files.set(form.url, ics().replace('SUMMARY:Vereinsfest', `SUMMARY:Vereinsfest\r\nDESCRIPTION:Freigabe ${source.code}`));
    // In an entry alone the code does not count, and nothing is read from the unconfirmed calendar.
    const first = await reg.check(source.id, key);
    expect(first.result).toMatchObject({ codeFound: false, upcoming: 0 });
    expect(first.result.message).toMatch(/Beschreibung des Kalenders/);
    tick(31_000);
    files.set(form.url, ics(source.code).replace('SUMMARY:Vereinsfest', `SUMMARY:Vereinsfest\r\nDESCRIPTION:Freigabe ${source.code}`));
    expect((await reg.check(source.id, key)).source.status).toBe('active');
    const q = { scope: 'de' as const, from: new Date('2026-12-01T00:00:00Z'), to: new Date('2026-12-10T00:00:00Z') };
    const [e] = (await reg.providers()[0].fetchEvents(q)).events;
    expect(e.description).toBe('Freigabe');
  });

  it('withdraws a live source when a regular download misses the code', async () => {
    const { reg, files } = setup('auto');
    const { source, key } = reg.submit(form);
    files.set(form.url, ics(source.code));
    await reg.check(source.id, key);
    const [p] = reg.providers();
    files.set(form.url, ics());
    const q = { scope: 'de' as const, from: new Date('2026-12-01T00:00:00Z'), to: new Date('2026-12-10T00:00:00Z') };
    await expect(p.fetchEvents(q)).rejects.toThrow(/Freigabe/);
    expect(reg.get(source.id, key).source.status).toBe('withdrawn');
  });

  it('waits for the operator on a public server', async () => {
    const { reg, files } = setup('manual');
    const { source, key } = reg.submit(form);
    files.set(form.url, ics(source.code));
    const r = await reg.check(source.id, key);
    expect(r.source.status).toBe('waiting');
    expect(r.result.message).toMatch(/von Hand/);
    expect(reg.providers()).toHaveLength(0);
  });

  it('needs the right key, refuses duplicates and blocked sites', async () => {
    const { reg, files, file } = setup('auto');
    const { source, key } = reg.submit(form);
    expect(() => reg.get(source.id, 'falsch')).toThrow(/gibt es nicht/);
    expect(() => reg.remove('unbekannt', key)).toThrow(/gibt es nicht/);
    files.set(form.url, ics(source.code));
    await reg.check(source.id, key);
    expect(() => reg.submit(form)).toThrow(/schon verbunden/);

    const list = JSON.parse(readFileSync(file, 'utf8'));
    list[0].status = 'blocked'; // no scope given, as in blocks from older versions: the whole site

    writeFileSync(file, JSON.stringify(list));
    expect(() => reg.submit({ ...form, url: 'https://www.verein.example/anderer.ics' })).toThrow(/gesperrt/);
    expect(() => reg.remove(source.id, key)).toThrow(/Betreiber/);
    expect(reg.providers()).toHaveLength(0);
  });

  const editFile = (file: string, fn: (list: Record<string, unknown>[]) => void) => {
    const list = JSON.parse(readFileSync(file, 'utf8'));
    fn(list);
    writeFileSync(file, JSON.stringify(list));
  };
  const q = { scope: 'local' as const, center: { lat: 49.87, lon: 8.65 }, radiusKm: 10, from: new Date('2026-12-01T00:00:00Z'), to: new Date('2026-12-10T00:00:00Z') };
  async function twoLive(secondUrl: string) {
    const env = setup('auto');
    const a = env.reg.submit(form);
    const b = env.reg.submit({ ...form, url: secondUrl });
    env.files.set(form.url, ics(a.source.code));
    env.files.set(secondUrl, ics(b.source.code));
    await env.reg.check(a.source.id, a.key);
    await env.reg.check(b.source.id, b.key);
    expect(env.reg.providers()).toHaveLength(2);
    return { ...env, a, b };
  }

  it('a blocked address stops only that address', async () => {
    const { reg, file, a, b } = await twoLive('https://verein.example/jugend.ics');
    editFile(file, (l) => void Object.assign(l.find((x) => x.id === a.source.id)!, { status: 'blocked', blockScope: 'address' }));
    expect(reg.providers()).toHaveLength(1);
    for (const url of [form.url, `${form.url}?x=1`, 'https://www.verein.example//Kalender.ics/', 'https://verein.example/kalender%2Eics#neu']) {
      expect(() => reg.submit({ ...form, url })).toThrow(/Adresse ist für Umkreis gesperrt/);
    }
    expect(reg.submit({ ...form, url: 'https://verein.example/senioren.ics' }).source.status).toBe('pending');
    expect(() => reg.remove(a.source.id, a.key)).toThrow(/Betreiber/);
    await expect(reg.check(a.source.id, a.key)).rejects.toThrow(/gesperrt/);
    expect(reg.get(b.source.id, b.key).source.status).toBe('active');
  });

  it('a blocked site covers its subdomains and every spelling of the host', async () => {
    const { reg, file, a, b } = await twoLive('https://jugend.verein.example/k.ics');
    editFile(file, (l) => void (l.find((x) => x.id === a.source.id)!.status = 'blocked'));
    expect(reg.providers()).toHaveLength(0);
    await expect(reg.check(b.source.id, b.key)).rejects.toThrow(/gesperrt/);
    for (const url of ['https://VEREIN.example./neu.ics', 'https://www.verein.example/neu.ics', 'https://jugend.verein.example/neu.ics']) {
      expect(() => reg.submit({ ...form, url })).toThrow(/Website ist für Umkreis gesperrt/);
    }
    expect(reg.submit({ ...form, url: 'https://anderer-verein.example/k.ics' }).source.status).toBe('pending');
  });

  it('a second sign-up for a blocked address cannot go live', async () => {
    const { reg, files, file } = setup('auto');
    const a = reg.submit(form);
    const b = reg.submit({ ...form, url: `${form.url}?neu=1` });
    files.set(`${form.url}?neu=1`, ics(b.source.code));
    editFile(file, (l) => void Object.assign(l.find((x) => x.id === a.source.id)!, { status: 'blocked', blockScope: 'address' }));
    await expect(reg.check(b.source.id, b.key)).rejects.toThrow(/gesperrt/);
    expect(reg.get(b.source.id, b.key).source.status).toBe('pending');
    expect(reg.providers()).toHaveLength(0);
  });

  it('keeps an operator block made while a check is downloading', async () => {
    const { reg, files, file, fetchFn } = setup('auto');
    const { source, key } = reg.submit(form);
    files.set(form.url, ics(source.code));
    fetchFn.mockImplementationOnce(async (u: string) => {
      editFile(file, (l) => void (l[0].status = 'blocked'));
      return new Response(files.get(u));
    });
    await expect(reg.check(source.id, key)).rejects.toThrow(/gesperrt/);
    expect(JSON.parse(readFileSync(file, 'utf8'))[0].status).toBe('blocked');
    expect(reg.providers()).toHaveLength(0);
  });

  it('a feed losing its code does not lift a block', async () => {
    const { reg, files, file, a } = await twoLive('https://verein.example/jugend.ics');
    const p = reg.providers()[0];
    editFile(file, (l) => void (l.find((x) => x.id === a.source.id)!.status = 'blocked'));
    files.set(form.url, ics());
    await p.fetchEvents(q).catch(() => {});
    expect(JSON.parse(readFileSync(file, 'utf8')).find((x: { id: string }) => x.id === a.source.id).status).toBe('blocked');
  });

  it('tells organisers when a page has no schema.org events', async () => {
    const { reg, files } = setup('auto');
    const url = 'https://verein.example/termine';
    const { source, key } = reg.submit({ ...form, url });
    files.set(url, `<!doctype html><html><head>${meta(source.code)}</head><body>Termine</body></html>`);
    const r = await reg.check(source.id, key);
    expect(r.result).toMatchObject({ codeFound: true, format: 'web', upcoming: 0 });
    expect(r.result.message).toMatch(/schema\.org/);
    expect(r.source.status).toBe('pending');
  });

  it('removes a source with its key', () => {
    const { reg } = setup();
    const { source, key } = reg.submit(form);
    expect(reg.remove(source.id, key)).toEqual({ removed: true });
    expect(() => reg.get(source.id, key)).toThrow(ConnectError);
  });
});

describe('connect API', () => {
  it('runs the sign-up flow over HTTP and limits sign-ups per client', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'umkreis-api-'));
    const cfg = loadServerConfig({ SOURCES_FILE: path.join(dir, 's.json'), DESTINATION_ONE: 'off' }, dir);
    expect(cfg.connect?.approval).toBe('auto');
    expect(loadServerConfig({ HOST: '0.0.0.0', DESTINATION_ONE: 'off' }, dir).connect?.approval).toBe('manual');
    expect(loadServerConfig({ CONNECT: 'off' }, dir).connect).toBeUndefined();

    let body = '';
    const connectFetch = (async () => new Response(body)) as unknown as typeof fetch;
    const handle = createApiHandler(cfg, (async () => new Response('[]')) as unknown as typeof fetch, {
      client: { capacity: 100, refillPerSec: 1 }, shared: { capacity: 100, refillPerSec: 1 }, connect: { capacity: 2, refillPerSec: 0.0001 },
    }, connectFetch);
    const srv = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const post = (p: string, b: unknown) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    try {
      expect(await (await fetch(`${base}/api/status`)).json()).toMatchObject({ mode: 'unconfigured', connect: { enabled: true, approval: 'auto', connected: 0 } });
      const created = await post('/api/connect', { url: 'https://verein.example/k.ics', name: 'Turnverein', areaLabel: 'Darmstadt', lat: 49.87, lon: 8.65, consent: true });
      expect(created.status).toBe(201);
      const { source, key } = (await created.json()) as { source: { id: string; code: string }; key: string };
      body = `BEGIN:VCALENDAR\r\nX-WR-CALDESC:${source.code}\r\nEND:VCALENDAR\r\n`;
      const checked = await post('/api/connect/check', { id: source.id, key });
      expect(await checked.json()).toMatchObject({ source: { status: 'active' }, result: { codeFound: true, format: 'ics', upcoming: 0 } });
      expect(await (await fetch(`${base}/api/status`)).json()).toMatchObject({ mode: 'live', connect: { connected: 1 } });
      expect((await post('/api/connect/status', { id: source.id, key: 'falsch' })).status).toBe(404);

      expect((await post('/api/connect', { url: 'https://b.example/k.ics', consent: true })).status).toBe(400);
      expect((await post('/api/connect', { url: 'https://c.example/k.ics', consent: true })).status).toBe(429);
      expect((await post('/api/connect/remove', { id: source.id, key })).status).toBe(200);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is switched off with CONNECT=off', async () => {
    const handle = createApiHandler(loadServerConfig({ CONNECT: 'off', DESTINATION_ONE: 'off' }, tmpdir()), (async () => new Response('[]')) as unknown as typeof fetch);
    const srv = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${base}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
