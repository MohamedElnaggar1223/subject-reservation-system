import 'dotenv/config';
import { getConnInfo } from '@hono/node-server/conninfo'
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
import { ROLES } from '@repo/validations';

/**
 * Route Imports
 *
 * EXAMPLE: Todo routes (demonstrates the pattern)
 * Add your own route modules below.
 */
import { todos } from './routes/todo.routes';
import { files } from './routes/file.routes';
import { links } from './routes/link.routes';
import { users } from './routes/user.routes';
import { subjects } from './routes/subject.routes';
import { sessions } from './routes/session.routes';
import { registrations } from './routes/registration.routes';
import { payments } from './routes/payment.routes';
import { escrowRoutes } from './routes/escrow.routes';
import { registrationSwapRoutes, changeRequestRoutes } from './routes/swap.routes';
import { notificationRoutes } from './routes/notification.routes';
import { audit } from './routes/audit.routes';
import { grade } from './routes/grade.routes';
import { reports } from './routes/report.routes';
import { teachers } from './routes/teacher.routes';
import { schoolFees } from './routes/school-fee.routes';
import { receipts } from './routes/receipt.routes';
import { exceptions } from './routes/exception.routes';
import { remarks } from './routes/remark.routes';

/**
 * Rate Limiter for Auth Routes
 *
 * Protects authentication endpoints from brute force attacks.
 * - Defaults to 50 requests per 15 minute window
 * - Keyed by IP address (handles proxies and Cloudflare)
 */
function getClientIp(c: { req: { header: (name: string) => string | undefined; raw: Request }; env?: any }): string {
  // Prefer Cloudflare-set header (cannot be spoofed by the client).
  // Fall back to the socket remote address from @hono/node-server.
  // Do NOT trust x-forwarded-for — it is trivially spoofable without a
  // trusted proxy chain.
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp;

  try {
    const info = getConnInfo(c as any);
    if (info.remote.address) return info.remote.address;
  } catch {
    // getConnInfo may throw if the adapter doesn't support it
  }

  return 'unknown';
}

const authRateLimit = rateLimiter({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-6',
  skip: (c) => c.req.method === 'OPTIONS',
  keyGenerator: (c) => getClientIp(c),
});

const apiRateLimit = rateLimiter({
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  limit: env.API_RATE_LIMIT_MAX,
  standardHeaders: 'draft-6',
  // Never throttle preflights or health probes (uptime monitors poll these)
  skip: (c) => c.req.method === 'OPTIONS' || c.req.path.includes('/health'),
  keyGenerator: (c) => {
    const user = c.get?.('user' as never) as { id: string } | null;
    return user?.id ?? getClientIp(c);
  },
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
// Last line of defence: anything thrown outside a handler's own try/catch
// is logged with the request id and answered generically — never with the
// error text (RF-07).
.onError((err, c) => {
  logger.error(`[${c.get('requestId') ?? '-'}] unhandled ${c.req.method} ${c.req.path}: ${err.message}`);
  return c.json({ success: false, error: 'Internal server error' }, 500);
})
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
// Throttle every auth endpoint (sign-in, sign-up, password reset).
// Mounted BEFORE session extraction so unauthenticated floods are
// rejected without a DB round-trip.
.use("/api/auth/*", authRateLimit)
.use("*", async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });

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
// SECURITY (defense-in-depth): better-auth's own admin endpoints
// (/api/auth/admin/create-user, set-user-password, list-users, …) check
// only their better-auth permission — create-user even honours a
// client-supplied role. Application roles must never reach them, so the
// whole surface is admin-only regardless of what the access-control
// config grants. Desk onboarding does not use these endpoints.
.use("/api/auth/admin/*", async (c, next) => {
	const user = c.get("user");
	if (!user || user.role !== ROLES.ADMIN) {
		return c.json({ error: "Forbidden" }, 403);
	}
	await next();
})
.on(["POST", "GET"], "/api/auth/*", async (c) => {
  return auth.handler(c.req.raw);
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
   * Parent-Student Link routes mounted at /v1/links
   * - POST   /v1/links          - Parent creates link request
   * - GET    /v1/links/pending  - Get pending requests (role-aware)
   * - PUT    /v1/links/:id      - Student approves/rejects request
   * - GET    /v1/links/children - Parent gets linked children
   * - GET    /v1/links/parents  - Student gets linked parents
   * - DELETE /v1/links/:id      - Admin removes link
   *
   * User profile routes mounted at /v1/users
   * - GET    /v1/users/me       - Get own profile
   * - PUT    /v1/users/me       - Update own profile
   * - GET    /v1/users          - List all users (admin)
   * - GET    /v1/users/:id      - Get user by ID (admin)
   * - PUT    /v1/users/:id      - Update user (admin)
   *
   * Subject routes mounted at /v1/subjects
   * - GET    /v1/subjects              - List subjects (auth; admin can filter isActive)
   * - GET    /v1/subjects/:id          - Get subject by ID (auth)
   * - POST   /v1/subjects              - Create subject (admin)
   * - PUT    /v1/subjects/:id          - Update subject (admin)
   * - DELETE /v1/subjects/:id          - Deactivate subject (admin, soft delete)
   * - PUT    /v1/subjects/:id/core     - Set core flag (admin)
   * - PUT    /v1/subjects/:id/activate - Reactivate subject (admin)
   *
   * Session routes mounted at /v1/sessions
   * - GET    /v1/sessions/active               - Get active sessions (auth)
   * - GET    /v1/sessions                      - List all sessions (admin)
   * - GET    /v1/sessions/:id                  - Get session by ID (admin)
   * - POST   /v1/sessions                      - Create session (admin)
   * - PUT    /v1/sessions/:id                  - Update session (admin)
   * - POST   /v1/sessions/:id/activate         - Manually activate draft (admin)
   * - POST   /v1/sessions/:id/close            - Manually close active (admin)
   *
   * Registration routes mounted at /v1/registrations
   * - GET    /v1/registrations/available       - Available subjects for a session (student/parent)
   * - GET    /v1/registrations/pending         - Pending approval requests (parent/admin)
   * - GET    /v1/registrations/history         - Registration history across all sessions
   * - GET    /v1/registrations                 - List registrations (role-aware)
   * - POST   /v1/registrations/request         - Student submits registration request
   * - POST   /v1/registrations/direct          - Parent registers directly for child
   * - PUT    /v1/registrations/approve         - Parent approves pending requests
   * - PUT    /v1/registrations/reject          - Parent rejects pending requests
   * - POST   /v1/registrations/admin-override  - Admin bypasses parent approval
   * - GET    /v1/registrations/:id             - Get single registration
   *
   * Payment routes mounted at /v1/payments
   * - GET    /v1/payments/checkout-summary     - Checkout summary for registrations (parent)
   * - GET    /v1/payments/pending-bank         - Pending bank transfers (admin)
   * - GET    /v1/payments                      - Payment history (parent/admin)
   * - POST   /v1/payments/initiate             - Initiate payment (parent only)
   * - GET    /v1/payments/:id                  - Single payment with registrations
   * - POST   /v1/payments/:id/confirm          - Admin confirms bank transfer
   * - POST   /v1/payments/webhook/fawry              - Fawry webhook
   * - POST   /v1/payments/webhook/paymob             - Paymob webhook
   *
   * Escrow routes mounted at /v1/escrow
   * - GET    /v1/escrow                              - Own balance (student read-only / parent with ?studentId)
   * - GET    /v1/escrow/children                     - Parent: all children balances
   * - GET    /v1/escrow/transactions                 - Transaction history (role-aware)
   * - POST   /v1/escrow/transfer                     - Parent transfers between children
   * - POST   /v1/escrow/withdraw                     - Parent requests withdrawal for child
   * - GET    /v1/escrow/withdrawals                  - Parent: withdrawal history for children
   * - GET    /v1/escrow/admin/withdrawals            - Admin: pending withdrawal requests
   * - POST   /v1/escrow/admin/withdrawals/:id/fulfill - Admin fulfills withdrawal
   * - POST   /v1/escrow/admin/withdrawals/:id/reject  - Admin rejects withdrawal
   *
   * Swap routes (registration-scoped) mounted at /v1/registrations:
   * - POST   /v1/registrations/:id/request-drop   - Student requests drop (SWAP-001)
   * - POST   /v1/registrations/:id/request-swap   - Student requests swap (SWAP-002)
   * - POST   /v1/registrations/:id/drop           - Parent direct drop (SWAP-004)
   * - POST   /v1/registrations/:id/swap           - Parent direct swap (SWAP-004)
   *
   * Change request routes mounted at /v1/change-requests:
   * - GET    /v1/change-requests                  - List (role-aware)
   * - GET    /v1/change-requests/:id              - Single request
   * - PUT    /v1/change-requests/:id/approve      - Parent approves (SWAP-003)
   * - PUT    /v1/change-requests/:id/reject       - Parent rejects (SWAP-003)
   *
   * Notification routes mounted at /v1/notifications:
   * - GET    /v1/notifications                    - Paginated notification list (unreadOnly filter)
   * - GET    /v1/notifications/unread-count       - Unread count for badge
   * - PUT    /v1/notifications/read-all           - Mark all as read
   * - PUT    /v1/notifications/:id/read           - Mark single as read
   * - POST   /v1/notifications/admin/announce     - Admin bulk announcement (NOT-011)
   *
   * Audit log routes mounted at /v1/audit (admin only):
   * - GET    /v1/audit/logs                       - Paginated audit log with filters (REP-006)
   * - GET    /v1/audit/entity/:type/:id           - Full chain-of-custody for a single entity
   *
   * Grade management routes mounted at /v1/grade (admin only):
   * - GET    /v1/grade/graduated                  - List all graduated students (GRADE-003)
   * - PUT    /v1/grade/:studentId                 - Manual grade adjustment (GRADE-002)
   *
   * Reports routes mounted at /v1/reports (admin only):
   * - GET    /v1/reports/dashboard                - Admin dashboard metrics (REP-008)
   * - GET    /v1/reports/registrations            - Registration report per session (REP-001)
   * - GET    /v1/reports/financial                - Financial summary per session (REP-002)
   * - GET    /v1/reports/escrow                   - Escrow balances report (REP-003)
   * - GET    /v1/reports/enrollment               - Subject enrollment counts (REP-004)
   * - GET    /v1/reports/compliance               - Grade 10 core compliance (REP-005)
   * - GET    /v1/reports/roster                   - Student roster by grade (REP-007)
   * - GET    /v1/reports/pending-approvals        - All pending approvals with age (REP-009)
   * All report routes support ?format=csv for CSV download.
   */
  // Throttle every v1 route (health probes are skipped in the limiter).
  // Previously only four groups were covered, leaving account creation,
  // desk onboarding, and the expensive report endpoints unlimited.
  .use('/*', apiRateLimit)
  .route('/todos', todos)
  .route('/files', files)
  .route('/links', links)
  .route('/users', users)
  .route('/subjects', subjects)
  .route('/sessions', sessions)
  .route('/registrations', registrations)
  .route('/registrations', registrationSwapRoutes)
  .route('/payments', payments)
  .route('/escrow', escrowRoutes)
  .route('/change-requests', changeRequestRoutes)
  .route('/notifications', notificationRoutes)
  .route('/audit', audit)
  .route('/grade', grade)
  .route('/reports', reports)
  .route('/teachers', teachers)
  .route('/school-fees', schoolFees)
  .route('/receipts', receipts)
  .route('/exceptions', exceptions)
  .route('/remarks', remarks);

// Mount v1 under /v1 (keep chaining for proper RPC typing)
// Exported for in-process tests (app.request) and for index.ts to serve.
export const appWithRoutes = app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/v1', v1);

export type AppType = typeof appWithRoutes;
