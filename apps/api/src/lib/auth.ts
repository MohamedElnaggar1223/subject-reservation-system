// No `dotenv/config` here: index.ts loads .env for the server (see app.ts).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "@repo/db";
import { expo } from "@better-auth/expo";
import { admin } from "better-auth/plugins";
import { emailVerificationRequired } from './auth-policy';
// NOTE: no nextCookies() here. That plugin is for better-auth running inside a
// Next.js server; this is a standalone Hono API. With it present, every
// server-side auth.api.* call (desk onboarding creates accounts that way)
// tried to import next/headers, which does not exist in this process.
import { ac, studentRole, adminRole, parentRole, financeOfficerRole, financeAdminRole, coordinatorRole, teacherRole, gateRole } from './permissions'
import { ROLES, CommonSchemas } from '@repo/validations';
import { corsOrigins, env } from '../env';
import { sendPasswordResetEmail, sendEmailVerificationEmail } from '../integrations/email';

/**
 * Validates password complexity using the shared CommonSchemas.password rules:
 * min 8 chars, at least 1 uppercase letter, at least 1 number.
 * Returns null if valid, or an error message string if invalid.
 */
function validatePasswordComplexity(password: string): string | null {
  const result = CommonSchemas.password.safeParse(password);
  if (!result.success) {
    return result.error.issues.map((i) => i.message).join('; ');
  }
  return null;
}

/**
 * The same body without session tokens, or the very same object when it
 * carries none (RF-12). Applied to every better-auth response, because the
 * token turned up in more of them than anyone listed: get-session,
 * list-sessions, sign-in, sign-up, change-password (revokeOtherSessions),
 * and the admin plugin's list-user-sessions and impersonate-user.
 *
 * Removed: a top-level `token`, and `token` on any session-shaped object
 * (one with userId and expiresAt) nested in the body or in an array.
 * Anything else, Dates included, comes back untouched.
 */
function withoutSessionTokens(body: unknown, depth = 0): unknown {
  if (depth > 4 || !body || typeof body !== 'object' || body instanceof Response || body instanceof Date) return body;
  if (Array.isArray(body)) {
    const out = body.map((item) => withoutSessionTokens(item, depth + 1));
    return out.some((item, i) => item !== body[i]) ? out : body;
  }
  const record = body as Record<string, unknown>;
  const sessionShaped = 'userId' in record && 'expiresAt' in record;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'token' && (depth === 0 || sessionShaped)) {
      changed = true;
      continue;
    }
    const next = withoutSessionTokens(value, depth + 1);
    if (next !== value) changed = true;
    out[key] = next;
  }
  return changed ? out : body;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }), 

  plugins: [
    expo(), 
    admin({
      ac,
      roles: {
        [ROLES.ADMIN]: adminRole,
        [ROLES.STUDENT]: studentRole,
        [ROLES.PARENT]: parentRole,
        [ROLES.FINANCE_OFFICER]: financeOfficerRole,
        [ROLES.FINANCE_ADMIN]: financeAdminRole,
        [ROLES.COORDINATOR]: coordinatorRole,
        [ROLES.TEACHER]: teacherRole,
        [ROLES.GATE]: gateRole,
      }
    }),
  ],

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: emailVerificationRequired(process.env.REQUIRE_EMAIL_VERIFICATION, env.NODE_ENV),
    sendResetPassword: async ({ user, url }) => {
      sendPasswordResetEmail(user.email, {
        recipientName: user.name,
        resetUrl: url,
      }).catch(err => console.error('[auth] Email send failed:', err));
    },
    resetPasswordTokenExpiresIn: 24 * 60 * 60,
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const path = (ctx as unknown as { path: string }).path;

      // Enforce password complexity on sign-up. An APIError, not a plain
      // Error: better-auth turns a plain Error into a 500 (RF-17), so the
      // family saw "Internal server error" instead of what to fix.
      if (path === '/sign-up/email') {
        const password = (ctx.body as { password?: string })?.password;
        if (password) {
          const error = validatePasswordComplexity(password);
          if (error) {
            throw new APIError('BAD_REQUEST', { message: error });
          }
        }
      }

      // Enforce password complexity on reset-password and change-password
      if (path === '/reset-password' || path === '/change-password') {
        const newPassword = (ctx.body as { newPassword?: string })?.newPassword;
        if (newPassword) {
          const error = validatePasswordComplexity(newPassword);
          if (error) {
            throw new APIError('BAD_REQUEST', { message: error });
          }
        }
      }
    }),
    // RF-12: the session token lives in an HttpOnly cookie so page scripts
    // cannot read it, but better-auth repeated it in several JSON bodies,
    // which let any injected script steal a working session (from the admin's
    // pages: every officer's session). Every body loses it; the cookie still
    // carries it. Nothing in the API, the web app or the Expo client reads it
    // from a body.
    after: createAuthMiddleware(async (ctx) => {
      const returned = ctx.context.returned as unknown;
      if (!returned || typeof returned !== 'object' || returned instanceof Response) return;
      const stripped = withoutSessionTokens(returned);
      // An object or an array, both serialised as JSON.
      if (stripped !== returned) return ctx.json(stripped as Record<string, unknown>);
    }),
  },

  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      sendEmailVerificationEmail(user.email, {
        recipientName: user.name,
        verificationUrl: url,
      }).catch(err => console.error('[auth] Email send failed:', err));
    },
  },

  trustedOrigins: corsOrigins,

  advanced: {
    // RF-18: better-auth skips its cross-site origin check whenever
    // NODE_ENV=test unless this is set, so the suite never exercised it and a
    // deployment started with NODE_ENV=test would run without it. Always on.
    disableOriginCheck: false,
    crossSubDomainCookies: {
      enabled: env.NODE_ENV === 'production' // Since you're on different ports, not subdomains
    },
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    }
  }
});