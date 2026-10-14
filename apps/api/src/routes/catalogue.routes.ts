/**
 * The exam catalogue (FEATURES_PLAN.md F0b), mounted at /v1/catalogue.
 *
 * Read (staff who work with subjects: admin, the desk, the coordinator,
 * teachers): boards, qualifications, units, the unit-to-award map, option
 * codes, and what each registrable row enters.
 * Change (the coordinator and admin): everything, audited — including the
 * board each subject and unit is entered with (owner decision 3).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  ROLES, IdParam, BoardCodeParam, UpdateBoard, CreateQualification, UpdateQualification, SetQualificationUnits,
  CreateUnit, UpdateUnit, CreateQualificationOption, UpdateQualificationOption, MapRegistrable, SubjectIdParam, LoadStarterSet,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAcademic, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as catalogue from '../services/catalogue.services';
import { SeriesError } from '../services/series.services';
import { StudentsKeptChanging } from '../lib/student-locks';

const fail = (err: unknown, fallback: string) => ({
  message: clientMessage(err, fallback),
  status: err instanceof catalogue.CatalogueError || err instanceof SeriesError || err instanceof StudentsKeptChanging ? err.status : 400,
});

/** Staff who read the catalogue: admin, the desk, the coordinator, teachers (not the gate). */
const requireCatalogueRead = () =>
  requireRole(ROLES.ADMIN, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.COORDINATOR, ROLES.TEACHER);

export const catalogueRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/', requireCatalogueRead(), async (c) => success(c, await catalogue.getCatalogue()))

  /**
   * GET /catalogue/entries?sessionId= — what each live registration of a
   * window enters and how the school's level code reads (F4's contract,
   * entryItemsFor, for the window's series panel).
   */
  .get('/entries', requireAcademic(), zValidator('query', z.object({ sessionId: z.string().min(1) })), async (c) =>
    success(c, await catalogue.entryItemsForWindow(c.req.valid('query').sessionId)))

  .put('/boards/:code', requireAcademic(), zValidator('param', BoardCodeParam), zValidator('json', UpdateBoard), async (c) => {
    try {
      return success(c, await catalogue.updateBoard(c.req.valid('param').code, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update the board');
      return error(c, f.message, f.status);
    }
  })

  .post('/qualifications', requireAcademic(), zValidator('json', CreateQualification), async (c) => {
    try {
      return success(c, await catalogue.createQualification(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the qualification');
      return error(c, f.message, f.status);
    }
  })

  .put('/qualifications/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateQualification), async (c) => {
    try {
      return success(c, await catalogue.updateQualification(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update the qualification');
      return error(c, f.message, f.status);
    }
  })

  .put('/qualifications/:id/units', requireAcademic(), zValidator('param', IdParam), zValidator('json', SetQualificationUnits), async (c) => {
    try {
      return success(c, await catalogue.setQualificationUnits(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to save the units');
      return error(c, f.message, f.status);
    }
  })

  .post('/qualifications/:id/options', requireAcademic(), zValidator('param', IdParam), zValidator('json', CreateQualificationOption), async (c) => {
    try {
      return success(c, await catalogue.createOption(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the option code');
      return error(c, f.message, f.status);
    }
  })

  .put('/options/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateQualificationOption), async (c) => {
    try {
      return success(c, await catalogue.updateOption(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update the option code');
      return error(c, f.message, f.status);
    }
  })

  .post('/units', requireAcademic(), zValidator('json', CreateUnit), async (c) => {
    try {
      return success(c, await catalogue.createUnit(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the unit');
      return error(c, f.message, f.status);
    }
  })

  .put('/units/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateUnit), async (c) => {
    try {
      return success(c, await catalogue.updateUnit(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to update the unit');
      return error(c, f.message, f.status);
    }
  })

  /** PUT /catalogue/registrable/:subjectId — its board, award and units (a board change moves its registrations). */
  .put('/registrable/:subjectId', requireAcademic(), zValidator('param', SubjectIdParam), zValidator('json', MapRegistrable), async (c) => {
    try {
      return success(c, await catalogue.mapRegistrable(c.req.valid('param').subjectId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to map the subject');
      return error(c, f.message, f.status);
    }
  })

  .post('/starter', requireAcademic(), zValidator('json', LoadStarterSet), async (c) => {
    try {
      return success(c, await catalogue.loadStarterSet(c.req.valid('json').set, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to load the starter set');
      return error(c, f.message, f.status);
    }
  });

export type CatalogueApi = typeof catalogueRoutes;
