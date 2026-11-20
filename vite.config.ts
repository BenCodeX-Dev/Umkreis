import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createApiHandler } from './server/api.ts';
import { loadServerConfig } from './server/config.ts';

/** Mounts the same /api handler the production server uses into the Vite dev server. */
function apiPlugin(mode: string): Plugin {
  return {
    name: 'umkreis-api',
    configureServer(server) {
      const config = loadServerConfig({ ...process.env, ...loadEnv(mode, process.cwd(), '') });
      config.warnings.forEach((w) => server.config.logger.warn(`Warnung: ${w}`));
      const api = createApiHandler(config);
      server.middlewares.use((req, res, next) => {
        api(req, res).then((handled) => !handled && next(), next);
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), apiPlugin(mode)],
  // Build output (dist/, the Mac app copy in build/) is not source: changes there must not reload the dev page.
  server: { watch: { ignored: ['**/build/**', '**/dist/**'] } },
}));
