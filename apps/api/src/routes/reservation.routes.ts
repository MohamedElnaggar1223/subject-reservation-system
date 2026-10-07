/**
 * Reservations, step B (RESERVATIONS_REWORK.md §3.5, §4.2, §4.5, §5; docs/features/RESERVATIONS_LINES.md):
 *
 * POST /registrations/:id/verify-prior  — the answer to a declared sitting (coordinator, admin,
 *                                         finance desk with the board's statement)
 * PUT  /registrations/:id/teacher       — the teacher on a line (admin, coordinator, finance desk)
 * GET  /sessions/:id/to-verify          — the session's To verify tab (coordinator, admin, finance read)
 * GET  /statement?studentId | ?familyId — the statement (the student, a linked parent, staff with
 *                                         student records)
 *
 * Each in its own router, mounted beside the existing ones at its prefix (app.ts).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  ROLES,
  FINANCE_ROLES,
  STUDENT_RECORD_ROLES,
  RegistrationId,
  VerifyPriorSitting,
  ChangeLineTeacher,
  ToVerifyQuery,
  StatementQuery,
  hasRole,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import { verifyPriorSitting, listToVerify, VerificationError } from '../services/verification.services';
import { changeLineTeacher, LineTeacherError } from '../services/line-teacher.services';
import { statementFor, familyOf } from '../services/statement.services';
import * as linkService from '../services/link.services';
import { z } from 'zod';

const VERIFIERS = [ROLES.COORDINATOR, ...FINANCE_ROLES] as const;

/** A refusal's status: the service's own, else a 400. */
function refusal(err: unknown, fallback: string) {
  const status = err instanceof VerificationError || err instanceof LineTeacherError ? err.status : 400;
  return { message: clientMessage(err, fallback), status };
}

export const lineRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /** The coordinator's (or the admin's, or the finance desk's with evidence) answer to a declared sitting (§3.5). */
  .post('/:id/verify-prior',
    requireRole(...VERIFIERS),
    zValidator('param', RegistrationId),
    zValidator('json', VerifyPriorSitting),
    async (c) => {
      const user = c.get('user')!;
      try {
        return success(c, await verifyPriorSitting(c.req.valid('param').id, c.req.valid('json'), { id: user.id, role: user.role ?? '' }, extractAuditContext(c)));
      } catch (err) {
        const r = refusal(err, 'Failed to record the answer');
        return error(c, r.message, r.status);
      }
    }
  )

  /** The teacher on a line, with a reason: never re-priced (§3.5, point 10). */
  .put('/:id/teacher',
    requireRole(...VERIFIERS),
    zValidator('param', RegistrationId),
    zValidator('json', ChangeLineTeacher),
    async (c) => {
      const user = c.get('user')!;
      try {
        return success(c, await changeLineTeacher(c.req.valid('param').id, c.req.valid('json'), user.id, extractAuditContext(c)));
      } catch (err) {
        const r = refusal(err, 'Failed to change the teacher');
        return error(c, r.message, r.status);
      }
    }
  );

export const sessionVerifyRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /** The session's To verify tab (§4.2): declared sittings awaiting the coordinator. */
  .get('/:id/to-verify',
    requireRole(...VERIFIERS),
    zValidator('param', z.object({ id: z.string().min(1) })),
    zValidator('query', ToVerifyQuery),
    async (c) => {
      const list = await listToVerify(c.req.valid('param').id, c.req.valid('query').show);
      if (!list) return error(c, 'Session not found', 404);
      return success(c, list);
    }
  );

export const statementRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /**
   * GET /statement?studentId= | ?familyId= (§4.5): a student reads their own; a parent a linked
   * child's, or the whole family's (their own account); staff with student records any.
   */
  .get('/',
    zValidator('query', StatementQuery),
    async (c) => {
      const user = c.get('user')!;
      const q = c.req.valid('query');
      try {
        if (user.role === ROLES.STUDENT) {
          if (q.familyId || (q.studentId && q.studentId !== user.id)) return error(c, 'Forbidden', 403);
          return success(c, await statementFor({ studentIds: [user.id], family: null }));
        }
        if (user.role === ROLES.PARENT) {
          if (q.familyId && q.familyId !== user.id) return error(c, 'Forbidden', 403);
          const children = await linkService.getLinkedChildren(user.id);
          if (q.studentId) {
            if (!children.some((ch) => ch.studentId === q.studentId)) return error(c, 'You are not linked to this student', 403);
            return success(c, await statementFor({ studentIds: [q.studentId], family: null }));
          }
          const fam = await familyOf(user.id);
          return success(c, await statementFor({ studentIds: fam?.studentIds ?? [], family: fam?.family ?? null }));
        }
        if (!hasRole(user.role, ...STUDENT_RECORD_ROLES)) return error(c, 'Forbidden', 403);
        if (q.studentId) {
          const s = await statementFor({ studentIds: [q.studentId], family: null });
          if (!s.students.length) return error(c, 'Student not found', 404);
          return success(c, s);
        }
        if (!q.familyId) return error(c, 'Name a student or a family', 400);
        const fam = await familyOf(q.familyId);
        if (!fam) return error(c, 'Family not found', 404);
        return success(c, await statementFor({ studentIds: fam.studentIds, family: fam.family }));
      } catch (err) {
        return error(c, clientMessage(err, 'Failed to load the statement'), 400);
      }
    }
  );
