import { cache } from 'react'
import { getServerApi } from '~/lib/hono-server'
import { apiResponse } from '@repo/validations'
import { ROLES, type Role } from '@repo/validations'
import { redirect } from 'next/navigation'

// Shape inferred from API response; keeps RPC typing
export type SessionData = {
  user: {
    id: string;
    createdAt: Date | string;
    updatedAt: Date | string;
    email: string;
    emailVerified: boolean;
    name: string;
    image?: string | null | undefined;
    banned: boolean | null | undefined;
    role?: string | null | undefined;
    banReason?: string | null | undefined;
    banExpires?: Date | string | null | undefined;
  };
  session: {
    id: string;
    createdAt: Date | string;
    updatedAt: Date | string;
    userId: string;
    expiresAt: Date | string;
    token: string;
    ipAddress?: string | null | undefined;
    userAgent?: string | null | undefined;
    impersonatedBy?: string | null | undefined;
  } | null;
};

// Cached per-request session fetch
export const getSession = cache(async (): Promise<SessionData | null> => {
  const api = await getServerApi()
  try {
    return await apiResponse(api.v1.session.$get())
  } catch {
    return null
  }
})

// Require specific roles; redirects if unauthorized
export async function requireRole(allowed: Role[] | Role) {
  const roles = Array.isArray(allowed) ? allowed : [allowed]
  const session = await getSession()
  if (!session) redirect('/sign-in')

  const role = session.user.role ?? undefined
  if (!role || !roles.includes(role as Role)) {
    redirect('/unauthorized')
  }

  return session
}

/**
 * Require any authenticated user
 *
 * Simpler than requireRole when you just need authentication
 * without caring about the specific role.
 */
export async function requireAuth() {
  const session = await getSession()
  if (!session) redirect('/sign-in')
  return session
}

// Convenience helpers for specific roles
export const requireAdmin = () => requireRole(ROLES.ADMIN)
export const requireCoach = () => requireRole(ROLES.COACH)
export const requireStudent = () => requireRole(ROLES.STUDENT)

// Alias for backwards compatibility
export const requireAuthenticated = requireAuth

