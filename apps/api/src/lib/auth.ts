import 'dotenv/config';
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@repo/db";
import { expo } from "@better-auth/expo";
import { admin } from "better-auth/plugins";
import { ac, studentRole, adminRole, coachRole, userRole } from './permissions'
import { ROLES } from '@repo/validations';
import { corsOrigins, env } from '../env';
import { nextCookies } from 'better-auth/next-js';

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
        [ROLES.COACH]: coachRole,
        [ROLES.USER]: userRole
      }
    }),
    nextCookies()
  ],

  emailAndPassword: {
    enabled: true
  },

  trustedOrigins: corsOrigins,

  advanced: {
    crossSubDomainCookies: {
      enabled: env.NODE_ENV === 'production' // Since you're on different ports, not subdomains
    },
    defaultCookieAttributes: {
      sameSite: env.NODE_ENV === 'production' ? 'lax' : "none",
      secure: true, // allow local dev over http
      partitioned: true, // partitioned only when secure
      domain: env.COOKIE_DOMAIN
    }
  }
});