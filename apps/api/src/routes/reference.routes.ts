/**
 * The reference data (COORDINATOR_REWORK.md §7, D1; Appendix A), mounted at /v1/reference: read by the
 * coordinator and the admin to pick subjects, and by finance (B3). Loaded by the seed; never edited here.
 *
 * - GET /reference/boards              — the boards with their rules and sittings (board dates)
 * - GET /reference/subjects?board=     — the subjects with code, name, group and their suggested rows
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ROLES, ReferenceSubjectsQuery } from '@repo/validations';
import { success } from '../lib/response';
import { requireAuth, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { referenceBoards, referenceSubjects } from '../services/setup/reference.services';

const READ = [ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as const;

export const referenceRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .get('/boards', requireRole(...READ), async (c) => success(c, await referenceBoards()))
  .get('/subjects', requireRole(...READ), zValidator('query', ReferenceSubjectsQuery), async (c) => success(c, await referenceSubjects(c.req.valid('query').board)));

export type ReferenceApi = typeof referenceRoutes;
