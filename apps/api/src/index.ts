import 'dotenv/config';
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './lib/auth'
import { HonoEnv } from './lib/types';
import { success, error } from './lib/response';
import { rateLimiter } from 'hono-rate-limiter'
import { env, corsOrigins } from './env';
import { pingDb } from '@repo/db';
import { logger } from './lib/logger';
import { randomUUID } from 'crypto';

/**
 * Route Imports
 *
 * EXAMPLE: Todo routes (demonstrates the pattern)
 * Add your own route modules below.
 */
import { todos } from './routes/todo.routes';
import { files } from './routes/file.routes';

/**
 * Rate Limiter for Auth Routes
 *
 * Protects authentication endpoints from brute force attacks.
 * - 5 requests per 15 minute window
 * - Keyed by IP address (handles proxies and Cloudflare)
 */
const authRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-6',
  keyGenerator: (c) =>
    c.req.header('x-forwarded-for') ||
    c.req.header('x-real-ip') ||
    c.req.header('cf-connecting-ip') ||
    c.req.raw.headers.get('host') ||
    'unknown',
});

/**
 * Global Middleware & App Shell
 *
 * Middleware order is critical! Each layer builds on the previous:
 * 1. Request ID tracking
 * 2. Expo origin normalization
 * 3. CORS with credentials
 * 4. Auth rate limiting
 * 5. Session extraction
 * 6. Auth handler
 */
const app = new Hono<HonoEnv>()
.use('*', async (c, next) => {
  const requestId = randomUUID();
  c.set('requestId', requestId);
  c.res.headers.set('x-request-id', requestId);
  logger.info(`[${requestId}] ${c.req.method} ${c.req.path}`);
  await next();
})
.use("*", async (c, next) => {
	// Convert Expo's expo-origin header to standard Origin header
	const expoOrigin = c.req.header("expo-origin");
	if (expoOrigin && !c.req.header("origin")) {
		c.req.raw.headers.set("origin", expoOrigin);
	}
	await next();
})
.use(
	"*", // or replace with "*" to enable cors for all routes
	cors({
		origin: corsOrigins,
		allowHeaders: ["Content-Type", "Authorization", "Cookie"],
		allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE"],
		exposeHeaders: ["Content-Length", "Set-Cookie", "Server-Timing"],
		maxAge: 600,
		credentials: true,
	})
)
.use("/api/auth/*", authRateLimit)
.use("*", async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
  console.log(c.req.raw.headers)

  	if (!session) {
    	c.set("user", null);
    	c.set("session", null);
    	await next();
        return;
  	}

  	c.set("user", session.user);
  	c.set("session", session.session);
  	await next();
})
.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const response = await auth.handler(c.req.raw);

  console.log('🌍 CORS Origins:', corsOrigins);

  const setCookieHeaders = response.headers.getSetCookie()
  console.log('🍪 Setting cookies:', setCookieHeaders);

	return response
});

/**
 * Versioned API (v1)
 *
 * All routes are mounted under /v1 for versioning.
 * This enables future API versions without breaking changes.
 *
 * RPC Type Safety: Export AppType for Hono RPC client
 */
const v1 = new Hono<HonoEnv>()
  // Health check endpoints
  .get('/health', (c) => c.json({ status: 'ok', version: 'v1' }))
  .get('/health/ready', async (c) => {
    const ok = await pingDb();
    if (ok) return c.json({ ready: true });
    logger.error('DB health check failed');
    return c.json({ ready: false, error: 'db unreachable' }, 503);
  })

  // Session endpoint - returns current authenticated user
  .get("/session", (c) => {
    const session = c.get("session");
    const user = c.get("user");

    if (!user) return error(c, 'Unauthorized', 401);

    return c.json({
      success: true,
      data: { session, user }
    });
  })

  /**
   * Feature Routes
   *
   * EXAMPLE: Todo routes mounted at /v1/todos
   * - GET    /v1/todos       - List user's todos
   * - POST   /v1/todos       - Create todo
   * - GET    /v1/todos/:id   - Get specific todo
   * - PUT    /v1/todos/:id   - Update todo
   * - DELETE /v1/todos/:id   - Delete todo (admin only)
   *
   * File upload routes mounted at /v1/files
   * - POST   /v1/files/avatar   - Upload avatar with thumbnails
   * - POST   /v1/files/document - Upload document
   * - POST   /v1/files          - Upload general file
   * - GET    /v1/files          - List user's files (paginated)
   * - GET    /v1/files/:id      - Get specific file
   * - DELETE /v1/files/:id      - Delete file
   *
   * Add your own routes below.
   */
  .route('/todos', todos)
  .route('/files', files);

// Mount v1 under /v1 (keep chaining for proper RPC typing)
const appWithRoutes = app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/v1', v1);

export type AppType = typeof appWithRoutes;

serve({
  fetch: appWithRoutes.fetch,
  port: env.PORT
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
});