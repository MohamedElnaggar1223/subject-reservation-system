import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiResponse, SessionSeedFileSchema, SubjectsFileSchema, REFERENCE_BOARD_CODES } from '@repo/validations';
import { admin, staff, one, sql, type Client } from './helpers';

/**
 * 08zb — the June 2027 pre-load (COORDINATOR_REWORK.md §8, §11): P0's subjects (packages/db/reference/
 * subjects/*.json) and P0's seed (packages/db/seeds/june-2027.json) loaded the way the seeds load them,
 * through the coordinator's set-up services. The scenario's session carries a label (its own sittings),
 * and the boards file is not loaded here: its real sittings would move board dates the earlier files'
 * series hold. Teachers stay placeholders (the names file is git-ignored).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '../../../packages/db');
const RUN = Math.random().toString(36).slice(2, 6);

describe('08zb: the June 2027 pre-load', () => {
  let adm: Client, coordinator: Client;
  let sessionId: string;
  const seed = SessionSeedFileSchema.parse(JSON.parse(readFileSync(path.join(dbDir, 'seeds', 'june-2027.json'), 'utf8')));
  const label = `pre-${RUN}`;

  beforeAll(async () => {
    adm = await admin(`zb08-${RUN}`);
    coordinator = await staff(adm, 'coordinator', `zb08-${RUN}`);
    const { db, loadReference } = await import('@repo/db');
    const subjects = Object.fromEntries(REFERENCE_BOARD_CODES.map((b) => [b, SubjectsFileSchema.parse(JSON.parse(readFileSync(path.join(dbDir, 'reference', 'subjects', `${b}.json`), 'utf8')))]));
    await loadReference(db, { boards: [], subjects });
  });

  it('loads §8 row for row: 25 subjects in their order, every row\'s cells, exam fee and source, its earlier exams; the teacher to be confirmed; no subject offered to families while course fees are not set', async () => {
    const { loadSessionSeed } = await import('../src/services/setup/preload.services');
    const out = await loadSessionSeed(seed, null, adm.id, { label });
    expect(out).toMatchObject({ created: true, offerings: 25 });
    sessionId = out.sessionId;
    const s = await apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id: sessionId } }));
    expect(s).toMatchObject({ sessionType: 'june', seriesYear: 2027, status: 'draft', selfStudyPercent: seed.session.selfStudyPercent, pricesFinal: false });
    expect(s.refundPolicy).toEqual(seed.session.refundPolicy);
    expect(s.offerings.map((o) => [o.board.code, o.subject.code])).toEqual(seed.offerings.map((o) => [o.board, o.subject]));
    for (const o of seed.offerings) {
      const got = s.offerings.find((x) => x.subject.code === o.subject && x.board.code === o.board)!;
      expect([got.subject.code, got.teacherTbc, got.teacherChoice, got.courseFee, got.teachers.length]).toEqual([o.subject, o.teacherTbc, o.teacherChoice, o.courseFee, o.teachers.length]);
      for (const r of o.rows) {
        const row = got.rows.find((x) => x.referenceKey === r.key)!;
        expect([o.subject, r.key, row.cells, row.examFee, row.examFeeSource, row.courseFee]).toEqual([o.subject, r.key, r.cells, r.examFee, r.examFeeSource, r.courseFee]);
        if (r.allowedPriorSittings) {
          const months: Record<number, string> = { 1: 'january', 6: 'june', 10: 'october', 11: 'november' };
          expect(row.allowedPriorSittings.map((p) => [p.month, p.year])).toEqual(r.allowedPriorSittings.map((p) => [months[p.month], p.year]));
        }
        expect(row.cellsByDefault).toEqual(r.cellsByDefault);
      }
      // Every other row the reference suggests stays unticked.
      for (const row of got.rows.filter((x) => !o.rows.some((r) => r.key === x.referenceKey))) {
        expect(Object.values(row.cells).some(Boolean)).toBe(false);
      }
      // E6: a course fee not set keeps every subject from families.
      expect(got.offeredToFamilies).toBe(false);
    }
    const ticked = await one<{ n: number }>(`select count(*)::int as n from session_offer_item where session_id = $1 and (first_in_school or retake_in_school or retake_self_study or first_self_study)`, [sessionId]);
    expect(ticked.n).toBe(seed.offerings.reduce((a, o) => a + o.rows.length, 0));
  });

  it("the session's check list carries the pre-load's notes and the cells a default ticked (Q10) for her review, a board date to enter, and the earlier exam older than the board carries forward (D6: kept, warned)", async () => {
    const s = await apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id: sessionId } }));
    const codes = s.checkList.map((c) => c.code);
    expect(codes.filter((c) => c === 'review_note')).toHaveLength(seed.offerings.reduce((a, o) => a + o.flags.length, 0));
    expect(codes.filter((c) => c === 'ticked_by_default')).toHaveLength(seed.offerings.reduce((a, o) => a + o.rows.filter((r) => r.cellsByDefault.length).length, 0));
    expect(s.checkList.filter((c) => c.code === 'sitting_no_board_date').every((c) => c.severity === 'blocks')).toBe(true);
    expect(codes).toContain('sitting_no_board_date');
    expect(s.checkList.find((c) => c.code === 'carried_from_too_old')?.message).toMatch(/November 2025 is older than the board carries a result forward/);
    // Notes name teachers only by placeholder in the committed file; with no names file they stay so.
    expect(s.checkList.filter((c) => c.code === 'review_note').every((c) => !/\{T-/.test(c.message))).toBe(true);
    // Saved by her, a subject's notes and its default ticks are reviewed.
    const ticked = s.offerings.find((o) => o.rows.some((r) => r.cellsByDefault.length))!;
    const res = await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: sessionId, offeringId: ticked.id }, json: { rows: ticked.rows.map((r) => ({ id: r.id, kind: r.kind as 'all_papers', cells: r.cells })) },
    }));
    expect(res.offering.rows.every((r) => r.cellsByDefault.length === 0)).toBe(true);
    const after = await apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id: sessionId } }));
    expect(after.checkList.filter((c) => c.offeringId === ticked.id && (c.code === 'ticked_by_default' || c.code === 'review_note'))).toEqual([]);
  });

  it('loaded again it changes nothing; June 2028 is made by copying it (C3)', async () => {
    const { loadSessionSeed } = await import('../src/services/setup/preload.services');
    const before = await one<{ n: number }>(`select count(*)::int as n from session_offer where session_id = $1`, [sessionId]);
    expect(await loadSessionSeed(seed, null, adm.id, { label })).toEqual({ sessionId, created: false, offerings: 0 });
    expect((await one<{ n: number }>(`select count(*)::int as n from session_offer where session_id = $1`, [sessionId])).n).toBe(before.n);
    const next = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: 2028, label, copyFromSessionId: sessionId } }));
    expect(next.copy).toMatchObject({ offerings: 25, yearsMoved: 1, skipped: [] });
    expect(await sql(`select count(*)::int as n from session_offer where session_id = $1 and cardinality(check_notes) > 0`, [next.id])).toEqual([{ n: 0 }]);
  });
});
