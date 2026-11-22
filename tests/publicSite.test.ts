import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_TILES, parseTileTemplate } from '../shared/mapTiles.ts';
import { loadServerConfig } from '../server/config.ts';
import { contentSecurityPolicy, createStaticHandler } from '../server/static.ts';

describe('parseTileTemplate', () => {
  it('accepts an https template and keeps the host', () => {
    expect(parseTileTemplate(' https://tiles.example.org/v1/{z}/{x}/{y}.png?key=abc ', ' © Example ')).toEqual({
      url: 'https://tiles.example.org/v1/{z}/{x}/{y}.png?key=abc',
      host: 'tiles.example.org',
      attribution: '© Example',
    });
    expect(parseTileTemplate('https://t.example.org:8443/{z}/{x}/{y}.png')?.host).toBe('t.example.org:8443');
  });

  it.each([
    ['http', 'http://tiles.example.org/{z}/{x}/{y}.png'],
    ['missing {y}', 'https://tiles.example.org/{z}/{x}.png'],
    ['duplicate {z}', 'https://tiles.example.org/{z}/{z}/{x}/{y}.png'],
    ['other placeholder', 'https://{s}.tiles.example.org/{z}/{x}/{y}.png'],
    ['credentials', 'https://user:pw@tiles.example.org/{z}/{x}/{y}.png'],
    ['CSP injection', "https://tiles.example.org/{z}/{x}/{y}.png; script-src 'unsafe-inline'"],
    ['quote', 'https://tiles.example.org/{z}/{x}/{y}.png"'],
    ['javascript', 'javascript:alert(1)//{z}/{x}/{y}'],
    ['too long', `https://tiles.example.org/${'a'.repeat(500)}/{z}/{x}/{y}.png`],
  ])('rejects %s', (_, url) => {
    expect(parseTileTemplate(url)).toBeNull();
  });

  it('strips control characters from the credit', () => {
    expect(parseTileTemplate('https://t.example.org/{z}/{x}/{y}.png', 'A\u0000\nB')?.attribution).toBe('A B');
  });
});

describe('public-site config', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'umkreis-cfg-'));
  mkdirSync(path.join(dir, 'config'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('uses a valid MAP_TILE_URL and warns when the credit is missing', () => {
    const cfg = loadServerConfig({ MAP_TILE_URL: 'https://tiles.example.org/{z}/{x}/{y}.png' }, dir);
    expect(cfg.mapTiles?.host).toBe('tiles.example.org');
    expect(cfg.warnings.some((w) => w.includes('MAP_TILE_ATTRIBUTION'))).toBe(true);
  });

  it('falls back to OpenStreetMap with a warning for an invalid MAP_TILE_URL', () => {
    const cfg = loadServerConfig({ MAP_TILE_URL: 'http://tiles.example.org/{z}/{x}/{y}.png' }, dir);
    expect(cfg.mapTiles).toBeUndefined();
    expect(cfg.warnings.some((w) => w.includes('MAP_TILE_URL ist ungültig'))).toBe(true);
  });

  it('has no legal pages and no warning when the default files are missing', () => {
    const cfg = loadServerConfig({}, dir);
    expect(cfg.legal).toBeUndefined();
    expect(cfg.warnings).toEqual([]);
  });

  it('reads the legal pages, normalises line ends and warns about a missing or oversized file', () => {
    writeFileSync(path.join(dir, 'config/impressum.txt'), '\r\nMax Muster\r\nStraße 1\r\n');
    writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(70_000));
    const cfg = loadServerConfig({ PRIVACY_FILE: 'big.txt' }, dir);
    expect(cfg.legal).toEqual({ impressum: 'Max Muster\nStraße 1', privacy: undefined });
    expect(cfg.warnings.some((w) => w.includes('größer als 64 KB'))).toBe(true);
    const missing = loadServerConfig({ IMPRESSUM_FILE: 'nope.txt' }, dir);
    expect(missing.legal).toBeUndefined();
    expect(missing.warnings.some((w) => w.includes('nope.txt nicht gefunden'))).toBe(true);
  });
});

describe('static handler CSP', () => {
  it('allows images only from this server and the configured tile host', async () => {
    expect(contentSecurityPolicy(DEFAULT_TILES.host)).toContain("img-src 'self' data: https://tile.openstreetmap.org;");
    const dir = mkdtempSync(path.join(tmpdir(), 'umkreis-dist-'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    const srv = createServer(createStaticHandler(dir, 'tiles.example.org'));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const res = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/`);
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("img-src 'self' data: https://tiles.example.org;");
      expect(csp).not.toContain('tile.openstreetmap.org');
      expect(csp).toContain("script-src 'self';");
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
