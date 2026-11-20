import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './api.ts';
import { effectiveAllowedHosts, loadServerConfig } from './config.ts';
import { createStaticHandler } from './static.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadServerConfig(process.env, root);
config.warnings.forEach((w) => console.warn(`Warnung: ${w}`));

const api = createApiHandler(config);
const serveStatic = createStaticHandler(path.join(root, 'dist'));
const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '127.0.0.1';
const allowedHosts = effectiveAllowedHosts(config, host, port);
if (!allowedHosts) console.warn(`Warnung: HOST=${host} ohne ALLOWED_HOSTS – Anfragen unter jedem Hostnamen werden beantwortet.`);

// The macOS app keeps our stdin open; when the app quits or crashes the pipe closes and the server follows.
if (process.env.EXIT_ON_STDIN_CLOSE === '1') {
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('error', () => process.exit(0));
  process.stdin.resume();
}

http
  .createServer((req, res) => {
    const started = Date.now();
    if (allowedHosts && !allowedHosts.includes((req.headers.host ?? '').toLowerCase())) {
      res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Unbekannter Host.');
      return;
    }
    // Log only method, path and status — never query strings or bodies (they may carry location data).
    res.on('finish', () => {
      const p = (req.url ?? '/').split('?')[0];
      if (p.startsWith('/api/')) console.log(`${req.method} ${p} ${res.statusCode} ${Date.now() - started}ms`);
    });
    api(req, res)
      .then((handled) => handled || serveStatic(req, res))
      .catch((err: unknown) => {
        console.error('Unerwarteter Fehler:', err instanceof Error ? err.message : err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Interner Fehler.' }));
      });
  })
  .listen(port, host, () => {
    const sources = [config.ticketmasterKey && 'Ticketmaster', config.feeds.length && `${config.feeds.length} iCal-Feed(s)`].filter(Boolean);
    console.log(`Umkreis läuft auf http://${host}:${port} – Quellen: ${sources.join(', ') || 'keine – TICKETMASTER_API_KEY oder iCal-Feeds einrichten (siehe README)'}`);
  });
