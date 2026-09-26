import 'dotenv/config';
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { db } from "@repo/db";
import { expo } from "@better-auth/expo";
import { admin } from "better-auth/plugins";
// NOTE: no nextCookies() here. That plugin is for better-auth running inside a
// Next.js server; this is a standalone Hono API. With it present, every
// server-side auth.api.* call (desk onboarding creates accounts that way)
// tried to import next/headers, which does not exist in this process.
import { ac, studentRole, adminRole, parentRole, financeOfficerRole, financeAdminRole } from './permissions'
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
      }
    }),
  ],

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
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

      // Enforce password complexity on sign-up
      if (path === '/sign-up/email') {
        const password = (ctx.body as { password?: string })?.password;
        if (password) {
          const error = validatePasswordComplexity(password);
          if (error) {
            throw new Error(error);
          }
        }
      }

      // Enforce password complexity on reset-password and change-password
      if (path === '/reset-password' || path === '/change-password') {
        const newPassword = (ctx.body as { newPassword?: string })?.newPassword;
        if (newPassword) {
          const error = validatePasswordComplexity(newPassword);
          if (error) {
            throw new Error(error);
          }
        }
      }
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