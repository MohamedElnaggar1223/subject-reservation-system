/**
 * The day-one import (FEATURES_PLAN.md F7), mounted at /v1/imports.
 *
 * Staff only — the admin and the coordinator (the upload purpose
 * `import_file` is theirs too). A staged file holds other families' names,
 * emails and phones: no family role, the desk, a teacher or the gate reaches
 * it (05-object-access). Registering families in an open window, and adding
 * catalogue rows (they carry prices), are the admin's.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  IdParam, CreateImport, ImportSettings, UpdateImportRows, UpdateImportPerson, CreateImportSubjects,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAcademic, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as imports from '../services/import.services';

const fail = (err: unknown, fallback: string) => ({
  message: clientMessage(err, fallback),
  status: err instanceof imports.ImportError ? err.status : 400,
});

const actorOf = (c: { get: (k: 'user') => { id: string; role?: string | null } | null }) => {
  const u = c.get('user')!;
  return { id: u.id, role: u.role ?? null };
};

export const importRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireAcademic())

  /** GET /imports — every import, newest first, with its counts. */
  .get('/', async (c) => {
    try {
      return success(c, await imports.listImports());
    } catch (err) {
      const f = fail(err, 'Failed to load the imports');
      return error(c, f.message, f.status);
    }
  })

  /** POST /imports { fileId, kind } — stage an uploaded file for review. */
  .post('/', zValidator('json', CreateImport), async (c) => {
    try {
      return success(c, await imports.stageImport(c.req.valid('json'), actorOf(c), extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to stage the file');
      return error(c, f.message, f.status);
    }
  })

  /** GET /imports/:id — the review: rows, people, families, mapping, problems, what a commit would do. */
  .get('/:id', zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await imports.getImportView(c.req.valid('param').id));
    } catch (err) {
      const f = fail(err, 'Failed to load the import');
      return error(c, f.message, f.status);
    }
  })

  /** PUT /imports/:id/settings — the mapping (series, subjects, teachers, the coordinator's answers). */
  .put('/:id/settings', zValidator('param', IdParam), zValidator('json', ImportSettings), async (c) => {
    try {
      await imports.updateImportSettings(c.req.valid('param').id, c.req.valid('json'), actorOf(c), extractAuditContext(c));
      return success(c, { ok: true });
    } catch (err) {
      const f = fail(err, 'Failed to change the mapping');
      return error(c, f.message, f.status);
    }
  })

  /** PUT /imports/:id/rows — fix, skip or include rows. */
  .put('/:id/rows', zValidator('param', IdParam), zValidator('json', UpdateImportRows), async (c) => {
    try {
      await imports.updateImportRows(c.req.valid('param').id, c.req.valid('json'), actorOf(c), extractAuditContext(c));
      return success(c, { ok: true });
    } catch (err) {
      const f = fail(err, 'Failed to change the rows');
      return error(c, f.message, f.status);
    }
  })

  /** PUT /imports/:id/people — a person's name or phone, a merge, "different people", "one child", skip. */
  .put('/:id/people', zValidator('param', IdParam), zValidator('json', UpdateImportPerson), async (c) => {
    try {
      await imports.updateImportPerson(c.req.valid('param').id, c.req.valid('json'), actorOf(c), extractAuditContext(c));
      return success(c, { ok: true });
    } catch (err) {
      const f = fail(err, 'Failed to change the person');
      return error(c, f.message, f.status);
    }
  })

  /** POST /imports/:id/subjects — catalogue rows for the sheet's subjects (the admin's). */
  .post('/:id/subjects', requireAdmin(), zValidator('param', IdParam), zValidator('json', CreateImportSubjects), async (c) => {
    try {
      await imports.createImportSubjects(c.req.valid('param').id, c.req.valid('json'), actorOf(c), extractAuditContext(c));
      return success(c, { ok: true }, 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the subjects');
      return error(c, f.message, f.status);
    }
  })

  /** POST /imports/:id/commit — every family that is ready, one transaction each. */
  .post('/:id/commit', zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await imports.commitImport(c.req.valid('param').id, actorOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to commit the import');
      return error(c, f.message, f.status);
    }
  })

  /** POST /imports/:id/discard — put the file aside; nothing it would make is made. */
  .post('/:id/discard', zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await imports.discardImport(c.req.valid('param').id, actorOf(c), extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to discard the import');
      return error(c, f.message, f.status);
    }
  });

export type ImportApi = typeof importRoutes;
