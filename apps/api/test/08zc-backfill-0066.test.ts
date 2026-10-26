import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_DB_NAME, TEST_PG_ADMIN_URL } from './env';

/**
 * 08zc — migrations 0065 and 0066 on data built the old way (COORDINATOR_REWORK.md §9.1, §11; the review
 * of P1a, M3). A scratch database of this run (`<TEST_DB_NAME>_m66`) is migrated to 0064, given sessions,
 * offers, items, fee keys, confirmed and provisional fee rows and version-1 lines as the deprecated routes
 * made them, then 0065 and 0066 are run as the migrator runs them (each statement in turn):
 *
 * - kinds in her words and the four cells from the offer's and the item's availability together;
 * - an item's exam fee only when every fee row it reads is confirmed — one reading a provisional row keeps
 *   the deprecated grid's pricing (no exam fee);
 * - prices final only on a session with an open item priced so and no provisional waiting line — not on
 *   one with a provisional row, nor on an empty session;
 * - every line's price, provisional mark and basis unchanged;
 * - 0066 run again changes nothing (the kind check is added once).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(here, '../../../packages/db/drizzle');
const SCRATCH = `${TEST_DB_NAME}_m66`;
const statements = (tag: string) => readFileSync(path.join(drizzleDir, `${tag}.sql`), 'utf8').split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);

describe('08zc: migrations 0065 and 0066 on data built the old way', () => {
  type Client = { query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>; end: () => Promise<void> };
  let admin: Client, db: Client;
  let tags: string[];
  const Y = 2031;
  /** As the migrator runs pending migrations: every statement in turn, in one transaction. */
  const migrate = async (list: string[]) => {
    await db.query('BEGIN');
    try {
      for (const tag of list) for (const st of statements(tag)) await db.query(st);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  };

  beforeAll(async () => {
    const { connectTo } = await import('@repo/db');
    if (!/^[a-z_][a-z0-9_]*_test_m66$/.test(SCRATCH)) throw new Error(`Refusing scratch database '${SCRATCH}'`);
    admin = connectTo(TEST_PG_ADMIN_URL);
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
    await admin.query(`CREATE DATABASE ${SCRATCH}`);
    db = connectTo(TEST_PG_ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${SCRATCH}$1`));
    const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    tags = journal.entries.sort((a, b) => a.idx - b.idx).map((e) => e.tag);
    expect(tags[65]).toMatch(/^0065_/);
    expect(tags[66]).toMatch(/^0066_/);
    await migrate(tags.slice(0, 65));

    // Built the old way: people, subjects, a June sitting, three sessions.
    await db.query(`insert into "user" (id, name, email, role) values ('m-admin', 'Admin', 'm-admin@example.test', 'admin'), ('m-stu', 'Student', 'm-stu@example.test', 'student')`);
    await db.query(`insert into subject (id, name, code, council, price_in_school) values
      ('m-bio', 'Biology', 'M-BIO', 'cambridge', 12000), ('m-chem', 'Chemistry', 'M-CHEM', 'cambridge', 12000), ('m-phys', 'Physics', 'M-PHYS', 'cambridge', 14000)`);
    await db.query(`insert into board_series (id, board_code, month, year, label, entry_deadline) values ('m-june', 'cambridge', 'june', $1, 'm66', now() + interval '60 days')`, [Y]);
    for (const [id, label] of [['m-a', 'a'], ['m-b', 'b'], ['m-c', 'c']]) {
      await db.query(`insert into registration_session (id, name, session_type, series_year, label, start_date, end_date, course_starts_on, payment_due_at, status)
        values ($1, $2, 'june', $3, $4, now() - interval '1 day', now() + interval '60 days', $5, now() + interval '30 days', 'active')`, [id, `June ${Y} ${label}`, Y, label, `${Y - 1}-10-01`]);
    }
    await db.query(`insert into session_board_series (id, session_id, board_series_id, board_code) values ('m-la', 'm-a', 'm-june', 'cambridge'), ('m-lb', 'm-b', 'm-june', 'cambridge')`);
    // Session A: Biology open (whole open; a one-paper retake; an A.2. route self-study only); Chemistry retakes only,
    // its fee row provisional.
    await db.query(`insert into session_offer (id, session_id, subject_id, availability, course_fee) values
      ('m-oa-bio', 'm-a', 'm-bio', 'open', 12000), ('m-oa-chem', 'm-a', 'm-chem', 'retake_only', 12000), ('m-ob-bio', 'm-b', 'm-bio', 'open', 12000)`);
    await db.query(`insert into session_offer_item (id, offer_id, session_id, label, kind, enters_kind, board_series_id, availability, course_fee, needs_prior_series, exclusive_group) values
      ('m-i-whole', 'm-oa-bio', 'm-a', 'Whole subject', 'whole', 'subject', 'm-june', 'open', null, false, 'entry'),
      ('m-i-paper', 'm-oa-bio', 'm-a', 'Paper 4 only (retake)', 'one_paper', 'subject', 'm-june', 'retake_only', 3000, false, 'entry'),
      ('m-i-a2', 'm-oa-bio', 'm-a', 'A.2. (carry forward)', 'route', 'subject', 'm-june', 'self_study_only', null, true, 'route'),
      ('m-i-chem', 'm-oa-chem', 'm-a', 'Whole subject', 'whole', 'subject', 'm-june', 'open', null, false, null),
      ('m-i-b', 'm-ob-bio', 'm-b', 'Whole subject', 'whole', 'subject', 'm-june', 'open', null, false, null)`);
    for (const item of ['m-i-whole', 'm-i-paper', 'm-i-a2', 'm-i-b']) {
      await db.query(`insert into session_offer_item_fee_key (id, item_id, key_kind, subject_id) values ($1, $2, 'subject', 'm-bio')`, [`fk-${item}`, item]);
    }
    await db.query(`insert into session_offer_item_fee_key (id, item_id, key_kind, subject_id) values ('fk-m-i-chem', 'm-i-chem', 'subject', 'm-chem')`);
    await db.query(`insert into board_fee (id, board_series_id, key_kind, subject_id, amount, provisional, confirmed_at) values
      ('m-fee-bio', 'm-june', 'subject', 'm-bio', 9850, false, now()),
      ('m-fee-chem', 'm-june', 'subject', 'm-chem', 10850, true, null)`);
    // Two version-1 lines: Biology's (confirmed fee), Chemistry's (provisional).
    const basis = (fee: number, provisional: boolean) => JSON.stringify({ v: 1, attempt: 'first', mode: 'in_school', itemKind: 'whole', courseFeeBase: 12000, coursePercent: 100, onePaperPercent: 100,
      boardFeeBase: fee, boardPercent: 100, feeRows: [{ id: provisional ? 'm-fee-chem' : 'm-fee-bio', amount: fee, provisional }], exceptionIds: [], customPrice: false, total: 12000 + fee });
    await db.query(`insert into registration (id, student_id, session_id, subject_id, offer_item_id, price_at_registration, course_fee_at_registration, registration_fee_at_registration,
        price_provisional, pricing_basis, status, attempt, is_retake, mode, due_at, requested_by) values
      ('m-l-bio', 'm-stu', 'm-a', 'm-bio', 'm-i-whole', 21850, 12000, 9850, false, $1::jsonb, 'pending_payment', 'first', false, 'in_school', now() + interval '30 days', 'm-stu'),
      ('m-l-chem', 'm-stu', 'm-a', 'm-chem', 'm-i-chem', 22850, 12000, 10850, true, $2::jsonb, 'pending_payment', 'retake', true, 'in_school', now() + interval '30 days', 'm-stu')`,
    [basis(9850, false), basis(10850, true)]);
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
    await admin?.end();
  });

  it('0065 and 0066 convert it: kinds and cells as the availabilities said, an exam fee only from confirmed rows, prices final only where everything open is priced so, every line as it was', async () => {
    const linesBefore = await db.query(`select id, price_at_registration::float as price, price_provisional as provisional, pricing_basis as basis, due_at from registration order by id`);
    await migrate(tags.slice(65, 67));

    const items = await db.query<{ id: string; kind: string; fi: boolean; ri: boolean; rs: boolean; fs: boolean; exam_fee: number | null; source: string | null }>(
      `select id, kind, first_in_school as fi, retake_in_school as ri, retake_self_study as rs, first_self_study as fs, exam_fee::float as exam_fee, exam_fee_source as source
       from session_offer_item order by id`);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId['m-i-whole']).toMatchObject({ kind: 'all_papers', fi: true, ri: true, rs: true, fs: false, exam_fee: 9850, source: 'typed' });
    // A one-paper retake takes no first entry; its fee row confirmed.
    expect(byId['m-i-paper']).toMatchObject({ kind: 'paper', fi: false, ri: true, rs: true, fs: false, exam_fee: 9850 });
    // The A.2.: self study, its own first entry and a retake.
    expect(byId['m-i-a2']).toMatchObject({ kind: 'a2', fi: false, ri: false, rs: true, fs: true });
    // Chemistry: the offer takes retakes only; its fee row provisional, so no exam fee — it keeps the grid's pricing.
    expect(byId['m-i-chem']).toMatchObject({ kind: 'all_papers', fi: false, ri: true, rs: true, fs: false, exam_fee: null, source: null });
    expect(byId['m-i-b']).toMatchObject({ exam_fee: 9850 });
    expect(await db.query(`select id, accepting from session_offer order by id`)).toEqual([
      { id: 'm-oa-bio', accepting: true }, { id: 'm-oa-chem', accepting: true }, { id: 'm-ob-bio', accepting: true },
    ]);
    // Prices final: B only (A reads a provisional row; C is empty).
    expect(await db.query(`select id, prices_final, prices_final_at is not null as at from registration_session order by id`)).toEqual([
      { id: 'm-a', prices_final: false, at: false }, { id: 'm-b', prices_final: true, at: true }, { id: 'm-c', prices_final: false, at: false },
    ]);
    // Every line as it was.
    expect(await db.query(`select id, price_at_registration::float as price, price_provisional as provisional, pricing_basis as basis, due_at from registration order by id`)).toEqual(linesBefore);
    // Audited in the same statements.
    expect((await db.query<{ entity_id: string }>(`select entity_id from audit_log where action = 'OFFER_ITEM_UPDATED' order by entity_id`)).map((r) => r.entity_id))
      .toEqual(['m-i-a2', 'm-i-b', 'm-i-paper', 'm-i-whole']);
    expect(await db.query(`select entity_id from audit_log where action = 'SESSION_UPDATED'`)).toEqual([{ entity_id: 'm-b' }]);
  });

  it('0066 run again changes nothing: no fee set twice, no session made final twice, the kind check added once', async () => {
    const snapshot = () => Promise.all([
      db.query(`select * from session_offer_item order by id`), db.query(`select id, prices_final from registration_session order by id`),
      db.query(`select count(*)::int as n from audit_log`),
    ]);
    const before = await snapshot();
    await migrate([tags[66]!]);
    const after = await snapshot();
    expect(after[1]).toEqual(before[1]);
    expect(after[2]).toEqual(before[2]);
    expect(after[0].map((r) => ({ ...r, updated_at: null }))).toEqual(before[0].map((r) => ({ ...r, updated_at: null })));
    expect(await db.query(`select count(*)::int as n from pg_constraint where conname = 'session_offer_item_kind_valid'`)).toEqual([{ n: 1 }]);
  });
});
