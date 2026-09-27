import { cache } from 'react'
import { getServerApi } from '~/lib/hono-server'
import { apiResponse } from '@repo/validations'
import { ROLES, type Role } from '@repo/validations'
import { redirect } from 'next/navigation'

const fetchSession = async () => apiResponse((await getServerApi()).v1.session.$get())

// Derived from the RPC fetcher, never hand-written: the hand-written copy
// that used to live here still promised a session token after the API
// stopped sending one (security audit RF-12).
export type SessionData = Awaited<ReturnType<typeof fetchSession>>

// Cached per-request session fetch
export const getSession = cache(async (): Promise<SessionData | null> => {
  try {
    return await fetchSession()
  } catch (err) {
    console.error('[session] getSession failed:', err instanceof Error ? err.message : err)
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
export const requireStudent = () => requireRole(ROLES.STUDENT)
export const requireParent = () => requireRole(ROLES.PARENT)
// Finance desk staff — admin included as a superset
export const requireFinance = () =>
  requireRole([ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.ADMIN])

// Alias for backwards compatibility
export const requireAuthenticated = requireAuth

