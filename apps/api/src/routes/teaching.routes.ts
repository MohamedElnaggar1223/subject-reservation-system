/**
 * The teacher capability (FEATURES_PLAN.md F0a), mounted at /v1/teaching.
 *
 * GET /teaching/me — for any staff account linked to a teacher record,
 * whatever its role (a coordinator or admin who teaches): the record, its
 * subjects and the homeroom sections it leads this year. An account with no
 * linked record is told so (404). Later features add the timetable (F1)
 * and the registers (F3).
 */

import { Hono } from 'hono';
import { success, error } from '../lib/response';
import { requireAuth, requireStaff } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { getTeachingFor } from '../services/teacher.services';

export const teachingRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/me', requireStaff(), async (c) => {
    const teaching = await getTeachingFor(c.get('user')!.id);
    if (!teaching) return error(c, 'Your account is not linked to a teacher record — ask the admin to link it on the Team page', 404);
    return success(c, teaching);
  });

export type TeachingApi = typeof teachingRoutes;
