/**
 * What the three roles F0a added may call (FEATURES_PLAN.md F0a, "Roles and
 * capabilities").
 *
 * `coordinator`, `teacher` and `gate` are denied every /v1 endpoint except
 * those listed here: self-service (their session, profile, notifications,
 * their own files) and what a feature grants them. The rule is enforced in
 * one place (app.ts, before any route) rather than on each route, because
 * many existing endpoints are open to any signed-in account and decide by
 * role inside the handler ("not a student and not a parent" reads as staff);
 * a new role must not fall into those branches by accident.
 *
 * A feature that gives one of these roles an endpoint adds the grant here
 * AND the route's own role gate, and records it in apps/api/test/
 * authz-policy.tsv; the matrix test (04) checks every endpoint for every
 * role against that file.
 */

import { ROLES } from '@repo/validations';

export const GRANTED_ROLES = [ROLES.COORDINATOR, ROLES.TEACHER, ROLES.GATE] as const;
type GrantedRole = (typeof GRANTED_ROLES)[number];

/** "METHOD /path" with :params, or a trailing * for a whole prefix. */
type Grant = string;

const SELF_SERVICE: Grant[] = [
  'GET /v1/session',
  'GET /v1/users/me',
  'PUT /v1/users/me',
  'POST /v1/users/me/change-email',
  'GET /v1/notifications',
  'GET /v1/notifications/unread-count',
  'PUT /v1/notifications/read-all',
  'PUT /v1/notifications/:id/read',
  // Their own files; the upload purpose decides what each may upload or read.
  'POST /v1/files/avatar',
  'POST /v1/files/document',
  'POST /v1/files/upload',
  'GET /v1/files',
  'GET /v1/files/:id',
  'GET /v1/files/:id/download',
  'GET /v1/files/:id/content',
  'DELETE /v1/files/:id',
];

/** School information every member of staff reads (F0a). */
const SCHOOL_INFO: Grant[] = [
  'GET /v1/academic/years',
  'GET /v1/academic/calendar',
  'GET /v1/academic/calendar/day',
  'GET /v1/academic/bell-schedules',
  'GET /v1/academic/rooms',
  // Teaching is a capability: answered only for an account linked to a
  // teacher record, whatever its role.
  'GET /v1/teaching/me',
];

export const ROLE_GRANTS: Record<GrantedRole, Grant[]> = {
  coordinator: [
    ...SELF_SERVICE,
    ...SCHOOL_INFO,
    // F0a: the academic structure, the student record, settings, the
    // grade-10 exception (the handler refuses money exceptions), and what
    // those screens read.
    '* /v1/academic/*',
    'GET /v1/students',
    'GET /v1/students/:id',
    'POST /v1/students/:id/leave',
    'GET /v1/settings',
    'PUT /v1/settings/:key',
    'GET /v1/exceptions',
    'POST /v1/exceptions',
    'POST /v1/exceptions/:id/revoke',
    'GET /v1/registrations/eligibility',
    'GET /v1/sessions',
    'GET /v1/sessions/active',
    'GET /v1/sessions/upcoming',
    'GET /v1/teachers',
    'GET /v1/teachers/:id',
  ],
  teacher: [...SELF_SERVICE, ...SCHOOL_INFO],
  gate: [...SELF_SERVICE, ...SCHOOL_INFO],
};

function toRegex(grant: Grant): { method: string; path: RegExp } {
  const [method, path] = grant.split(' ') as [string, string];
  const body = path
    .split('/')
    .map((seg) => (seg === '*' ? '.*' : seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return { method, path: new RegExp(`^${body}$`) };
}

const COMPILED = Object.fromEntries(
  Object.entries(ROLE_GRANTS).map(([role, grants]) => [role, grants.map(toRegex)]),
) as Record<GrantedRole, { method: string; path: RegExp }[]>;

export function isGrantedRole(role: string | null | undefined): role is GrantedRole {
  return (GRANTED_ROLES as readonly string[]).includes(role ?? '');
}

/** May this role call this endpoint at all? (The route's own gate still applies.) */
export function isGranted(role: GrantedRole, method: string, path: string): boolean {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return COMPILED[role].some((g) => (g.method === '*' || g.method === method) && g.path.test(p));
}
