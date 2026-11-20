import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createDemoProvider } from './providers/demo.ts';
import { createIcsProvider, validateFeed, type FeedConfig } from './providers/ics.ts';
import { createTicketmasterProvider } from './providers/ticketmaster.ts';
import type { EventProvider, FetchFn } from './providers/types.ts';

export interface ServerConfig {
  ticketmasterKey?: string;
  feeds: FeedConfig[];
  demoMode: 'auto' | 'on' | 'off';
  geocoderUrl: string;
  geocoderUserAgent: string;
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
  const mode = env.DEMO_MODE;
  return {
    ticketmasterKey: env.TICKETMASTER_API_KEY?.trim() || undefined,
    feeds,
    demoMode: mode === 'on' || mode === 'off' ? mode : 'auto',
    geocoderUrl: env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search',
    geocoderUserAgent: env.GEOCODER_USER_AGENT || 'Umkreis/0.1 (self-hosted local events app)',
    warnings,
  };
}

export function buildProviders(cfg: ServerConfig, fetchFn: FetchFn = fetch): { providers: EventProvider[]; mode: 'live' | 'demo' } {
  const real: EventProvider[] = [];
  if (cfg.ticketmasterKey) real.push(createTicketmasterProvider(cfg.ticketmasterKey, fetchFn));
  for (const feed of cfg.feeds) real.push(createIcsProvider(feed, fetchFn));
  if (cfg.demoMode === 'on' || (cfg.demoMode === 'auto' && real.length === 0)) {
    return { providers: [createDemoProvider()], mode: 'demo' };
  }
  return { providers: real, mode: 'live' };
}
