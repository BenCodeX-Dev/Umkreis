import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createIcsProvider, validateFeed, type FeedConfig } from './providers/ics.ts';
import { createTicketmasterProvider } from './providers/ticketmaster.ts';
import type { SourceMode } from '../shared/types.ts';
import type { EventProvider, FetchFn } from './providers/types.ts';

export interface ServerConfig {
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
  return {
    ticketmasterKey: env.TICKETMASTER_API_KEY?.trim() || undefined,
    feeds,
    geocoderUrl: env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search',
    geocoderUserAgent: env.GEOCODER_USER_AGENT || env.APP_USER_AGENT || 'Umkreis/0.2 (self-hosted local events app)',
    appUserAgent: env.APP_USER_AGENT || 'Umkreis/0.2 (self-hosted local events app)',
    allowedHosts: env.ALLOWED_HOSTS?.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) || undefined,
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    warnings,
  };
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
  if (cfg.ticketmasterKey) providers.push(createTicketmasterProvider(cfg.ticketmasterKey, fetchFn));
  for (const feed of cfg.feeds) providers.push(createIcsProvider(feed, fetchFn));
  return { providers, mode: providers.length > 0 ? 'live' : 'unconfigured' };
}
