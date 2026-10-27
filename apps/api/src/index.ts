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
import { loadReferenceFromFiles } from './services/setup/reference.services';

export type { AppType } from './app';

// A production API with no CLIENT_IP_HEADER keys rate limits on the socket
// address. Behind a proxy that is the proxy's address, so the whole school
// would share one sign-in budget (security audit, O-4).
if (env.NODE_ENV === 'production' && !env.CLIENT_IP_HEADER) {
  console.warn(
    '[security] CLIENT_IP_HEADER is not set. If this API runs behind a proxy or CDN, every user shares one rate-limit bucket; set it to the header that proxy writes.'
  );
}

// The board's list (the reference data, COORDINATOR_REWORK.md §7) loaded at every start, before anything is served
// (P1c): idempotent, so a database copied from an older one, or the deployed demo after its boot migration, holds
// the list the coordinator picks subjects from. A failure is logged and the API still starts (the list it had stays).
try {
  const loaded = await loadReferenceFromFiles();
  const { adminDatesKept, ...counts } = loaded;
  console.log(`[reference] loaded at start: ${JSON.stringify(counts)}`);
  for (const w of adminDatesKept) console.warn(`[reference] warning: ${w}`);
} catch (err) {
  console.error('[reference] the board\'s list was not loaded at start:', err);
}

// Start background jobs
startSessionScheduler();

serve({
  fetch: appWithRoutes.fetch,
  port: env.PORT
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
});
