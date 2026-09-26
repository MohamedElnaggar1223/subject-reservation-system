/**
 * Process entry: start the HTTP server and the background scheduler.
 *
 * The Hono app itself lives in ./app.ts so tests can drive it in-process
 * with `appWithRoutes.request(...)` without opening a port or starting the
 * session scheduler. Keep this file free of route definitions.
 *
 * This is also the only place `.env` is loaded. The app modules must not
 * import `dotenv/config` themselves: the integration suite imports ./app
 * directly, and a developer's apps/api/.env carries real Resend, R2 and
 * payment keys that must never reach a test run.
 */
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { appWithRoutes } from './app';
import { env } from './env';
import { startSessionScheduler } from './jobs/session-closer';

export type { AppType } from './app';

// Start background jobs
startSessionScheduler();

serve({
  fetch: appWithRoutes.fetch,
  port: env.PORT
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
});
