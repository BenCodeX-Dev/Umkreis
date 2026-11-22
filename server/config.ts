import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createDestinationOneProvider } from './providers/destinationone.ts';
import { createIcsProvider, validateFeed, type FeedConfig } from './providers/ics.ts';
import { createWebProvider } from './providers/web.ts';
import { createTicketmasterProvider } from './providers/ticketmaster.ts';
import { parseTileTemplate, type MapTiles } from '../shared/mapTiles.ts';
import type { SourceMode } from '../shared/types.ts';
import type { EventProvider, FetchFn } from './providers/types.ts';

export interface ServerConfig {
  /** destination.one open data (keyless). On unless DESTINATION_ONE=off. */
  openData?: boolean;
  ticketmasterKey?: string;
  feeds: FeedConfig[];
  geocoderUrl: string;
  geocoderUserAgent: string;
  /** Identifies Umkreis to third-party services (Panoramax); set APP_USER_AGENT to add contact details. */
  appUserAgent: string;
  /** When set, requests with any other Host header are refused (protects a local app from DNS rebinding). */
  allowedHosts?: string[];
  /** Count rate limits by X-Forwarded-For (set TRUST_PROXY=1 only behind your own reverse proxy). */
  trustProxy?: boolean;
  /** Tile service for the in-app map (MAP_TILE_URL); missing means OpenStreetMap's public tiles. */
  mapTiles?: MapTiles;
  /** Plain-text legal pages shown in the footer (config/impressum.txt, config/datenschutz.txt). */
  legal?: { impressum?: string; privacy?: string };
  /** "Kalender verbinden" for organisers (CONNECT=off disables it). Sources are kept in `file` (SOURCES_FILE). */
  connect?: { file: string; approval: 'auto' | 'manual' };
  warnings: string[];
}

type Env = Record<string, string | undefined>;

export function loadServerConfig(env: Env, root = process.cwd()): ServerConfig {
  const warnings: string[] = [];
  const feeds: FeedConfig[] = [];
  const feedsFile = path.resolve(root, env.ICS_FEEDS_FILE || 'config/feeds.json');
  if (existsSync(feedsFile)) {
    try {
      const list: unknown = JSON.parse(readFileSync(feedsFile, 'utf8'));
      for (const raw of Array.isArray(list) ? list : []) {
        const res = validateFeed(raw);
        if (typeof res === 'string') warnings.push(`iCal-Feed übersprungen: ${res}`);
        else feeds.push(res);
      }
    } catch {
      warnings.push(`${path.basename(feedsFile)} ist kein gültiges JSON – iCal-Feeds deaktiviert.`);
    }
  }
  let mapTiles: MapTiles | undefined;
  if (env.MAP_TILE_URL?.trim()) {
    mapTiles = parseTileTemplate(env.MAP_TILE_URL, env.MAP_TILE_ATTRIBUTION) ?? undefined;
    if (!mapTiles) warnings.push('MAP_TILE_URL ist ungültig (nur https, mit {z}, {x} und {y}) – die Karte nutzt OpenStreetMap.');
    else if (!mapTiles.attribution) warnings.push('MAP_TILE_ATTRIBUTION fehlt – die meisten Kacheldienste verlangen eine sichtbare Namensnennung.');
  }
  const legal = {
    impressum: readLegalText(root, env.IMPRESSUM_FILE, 'config/impressum.txt', 'IMPRESSUM_FILE', warnings),
    privacy: readLegalText(root, env.PRIVACY_FILE, 'config/datenschutz.txt', 'PRIVACY_FILE', warnings),
  };

  return {
    openData: !/^(0|off|false|no|aus)$/i.test(env.DESTINATION_ONE?.trim() ?? ''),
    ticketmasterKey: env.TICKETMASTER_API_KEY?.trim() || undefined,
    feeds,
    geocoderUrl: env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search',
    geocoderUserAgent: env.GEOCODER_USER_AGENT || env.APP_USER_AGENT || 'Umkreis/0.2 (self-hosted local events app)',
    appUserAgent: env.APP_USER_AGENT || 'Umkreis/0.2 (self-hosted local events app)',
    allowedHosts: env.ALLOWED_HOSTS?.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) || undefined,
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    mapTiles,
    legal: legal.impressum || legal.privacy ? legal : undefined,
    connect: /^(0|off|false|no|aus)$/i.test(env.CONNECT?.trim() ?? '')
      ? undefined
      : {
          file: path.resolve(root, env.SOURCES_FILE || 'data/sources.json'),
          // On a private server (loopback) the owner connects their own calendars; a public one needs approval.
          approval: env.CONNECT_APPROVAL === 'auto' || env.CONNECT_APPROVAL === 'manual'
            ? env.CONNECT_APPROVAL
            : isLoopbackHost(env.HOST || '127.0.0.1') ? 'auto' : 'manual',
        },
    warnings,
  };
}

const LEGAL_MAX_BYTES = 64_000;

/** Reads an optional plain-text page. The default path may be missing; an explicitly set one should exist. */
function readLegalText(root: string, setPath: string | undefined, fallback: string, name: string, warnings: string[]): string | undefined {
  const file = path.resolve(root, setPath?.trim() || fallback);
  if (!existsSync(file)) {
    if (setPath?.trim()) warnings.push(`${name}: ${path.basename(file)} nicht gefunden.`);
    return undefined;
  }
  if (statSync(file).size > LEGAL_MAX_BYTES) {
    warnings.push(`${name}: ${path.basename(file)} ist größer als 64 KB und wird nicht angezeigt.`);
    return undefined;
  }
  const text = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim();
  return text || undefined;
}

/** True when the server only listens on this machine (no Impressum needed, no public visitors). */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host);
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * A server bound to loopback answers only to its own names unless ALLOWED_HOSTS says otherwise, so a
 * web page cannot reach it under a foreign name (DNS rebinding). Other binds need ALLOWED_HOSTS.
 */
export function effectiveAllowedHosts(cfg: ServerConfig, host: string, port: number): string[] | undefined {
  if (cfg.allowedHosts) return cfg.allowedHosts;
  if (!LOOPBACK.has(host)) return undefined;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

/** Real sources only. Without any, the app says so and shows no events – nothing is invented. */
export function buildProviders(cfg: ServerConfig, fetchFn: FetchFn = fetch): { providers: EventProvider[]; mode: SourceMode } {
  const providers: EventProvider[] = [];
  if (cfg.openData) providers.push(createDestinationOneProvider(fetchFn, cfg.appUserAgent));
  if (cfg.ticketmasterKey) providers.push(createTicketmasterProvider(cfg.ticketmasterKey, fetchFn));
  for (const feed of cfg.feeds) providers.push(feed.format === 'web' ? createWebProvider(feed, fetchFn) : createIcsProvider(feed, fetchFn));
  return { providers, mode: providers.length > 0 ? 'live' : 'unconfigured' };
}
