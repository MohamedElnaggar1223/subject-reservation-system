import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_DB_NAME, TEST_PG_ADMIN_URL } from './env';

/**
 * 08zf — P1c's migrations on data built the old way (COORDINATOR_REWORK.md §9.1, §11; .audit/coordinator-p1c.tsv).
 * A scratch database of this run (`<TEST_DB_NAME>_m72`) is migrated to 0070, given sessions, items with fee keys,
 * confirmed and provisional fee rows, version-1 lines (waiting and paid) and the board-deadline reminder kind's
 * rules, one of which sent a reminder; then 0071 and 0072 are run as the migrator runs them (each statement in turn,
 * in one transaction):
 *
 * - 0072 refuses, naming it, a waiting line priced provisional from the grid on a row with no exam fee in a session
 *   whose prices are final (nothing could make it payable once the grid is gone), and changes nothing;
 * - a row priced from the grid takes the sum of its grid rows as its exam fee, audited — where every grid row it reads
 *   is confirmed, or its session's prices are not final yet; one reading a provisional row in a session whose prices
 *   are final stays "not set" (the fix round's S1), as does one whose keys miss a grid row;
 * - every version-1 line no longer provisional, whatever its status, keeps the grid's last word in its basis
 *   (`feeConfirmedAt`): its fee row's confirmation, or the prices-final switch's time for one the old Confirm did not
 *   clear (P1b fix 1); a provisional line gets none;
 * - every line's price, provisional mark and status unchanged;
 * - the grid, the fee keys and the availability columns dropped;
 * - 0071: the board-deadline reminder rule that never sent anything is deleted (audited); one that sent a reminder is
 *   kept switched off for its message; its template switched off; no new rule of the kind can be made.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(here, '../../../packages/db/drizzle');
const SCRATCH = `${TEST_DB_NAME}_m72`;
const statements = (tag: string) => readFileSync(path.join(drizzleDir, `${tag}.sql`), 'utf8').split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);

describe('08zf: migrations 0071 and 0072 on data built the old way', () => {
  type Client = { query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>; end: () => Promise<void> };
  let admin: Client, db: Client;
  let tags: string[];
  const Y = 2032;
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
  const basis = (fee: { id: string; amount: number; provisional: boolean }) => JSON.stringify({
    v: 1, attempt: 'first', mode: 'in_school', itemKind: 'whole', courseFeeBase: 12000, coursePercent: 100, onePaperPercent: 100,
    boardFeeBase: fee.amount, boardPercent: 100, feeRows: [{ id: fee.id, keyKind: 'subject', keyId: 'x', amount: fee.amount, provisional: fee.provisional }],
    exceptionIds: [], customPrice: false, courseFee: 12000, registrationFee: fee.amount, total: 12000 + fee.amount,
  });
  const line = (id: string, session: string, subj: string, item: string, fee: { id: string; amount: number; provisional: boolean }, status: string, provisional: boolean, student = 'p-stu') =>
    db.query(`insert into registration (id, student_id, session_id, subject_id, offer_item_id, price_at_registration, course_fee_at_registration, registration_fee_at_registration,
        price_provisional, pricing_basis, status, attempt, is_retake, mode, due_at, requested_by)
      values ($1, $10, $2, $3, $4, $5, 12000, $6, $7, $8::jsonb, $9, 'first', false, 'in_school', now() + interval '30 days', $10)`,
    [id, session, subj, item, 12000 + fee.amount, fee.amount, provisional, basis(fee), status, student]);

  beforeAll(async () => {
    const { connectTo } = await import('@repo/db');
    if (!/^[a-z_][a-z0-9_]*_test_m72$/.test(SCRATCH)) throw new Error(`Refusing scratch database '${SCRATCH}'`);
    admin = connectTo(TEST_PG_ADMIN_URL);
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
    await admin.query(`CREATE DATABASE ${SCRATCH}`);
    db = connectTo(TEST_PG_ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${SCRATCH}$1`));
    const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    tags = journal.entries.sort((a, b) => a.idx - b.idx).map((e) => e.tag);
    expect(tags[71]).toMatch(/^0071_/);
    expect(tags[72]).toMatch(/^0072_/);
    await migrate(tags.slice(0, 71));

    await db.query(`insert into "user" (id, name, email, role) values ('p-stu', 'Student', 'p-stu@example.test', 'student'), ('p-stu2', 'Student 2', 'p-stu2@example.test', 'student')`);
    await db.query(`insert into subject (id, name, code, council, price_in_school) values
      ('p-bio', 'Biology', 'P-BIO', 'cambridge', 12000), ('p-chem', 'Chemistry', 'P-CHEM', 'cambridge', 12000), ('p-phys', 'Physics', 'P-PHYS', 'cambridge', 12000),
      ('p-geo', 'Geography', 'P-GEO', 'cambridge', 12000), ('p-hist', 'History', 'P-HIST', 'cambridge', 12000)`);
    await db.query(`insert into board_series (id, board_code, month, year, label, entry_deadline) values ('p-june', 'cambridge', 'june', $1, 'm72', now() + interval '90 days')`, [Y]);
    // A: prices not final (as 0066 left a session reading a provisional row). B: prices final five days ago.
    await db.query(`insert into registration_session (id, name, session_type, series_year, label, start_date, end_date, course_starts_on, payment_due_at, status, prices_final, prices_final_at) values
      ('p-a', 'June A', 'june', $1, 'a', now() - interval '1 day', now() + interval '60 days', $2, now() + interval '30 days', 'active', false, null),
      ('p-b', 'June B', 'june', $1, 'b', now() - interval '1 day', now() + interval '60 days', $2, now() + interval '30 days', 'active', true, now() - interval '5 days')`, [Y, `${Y - 1}-10-01`]);
    await db.query(`insert into session_board_series (id, session_id, board_series_id, board_code) values ('p-la', 'p-a', 'p-june', 'cambridge'), ('p-lb', 'p-b', 'p-june', 'cambridge')`);
    await db.query(`insert into session_offer (id, session_id, subject_id, availability, course_fee) values
      ('p-oa-bio', 'p-a', 'p-bio', 'open', 12000), ('p-oa-chem', 'p-a', 'p-chem', 'open', 12000), ('p-oa-phys', 'p-a', 'p-phys', 'open', 12000),
      ('p-ob-bio', 'p-b', 'p-bio', 'open', 12000), ('p-ob-geo', 'p-b', 'p-geo', 'open', 12000), ('p-ob-hist', 'p-b', 'p-hist', 'open', 12000)`);
    // Biology priced by its row since 0066 (its grid row confirmed); Chemistry (A, prices not final) and Geography (B, prices
    // final) read a provisional grid row; History (B) a confirmed one its row never took (made after 0066); Physics reads none.
    await db.query(`insert into session_offer_item (id, offer_id, session_id, label, kind, enters_kind, board_series_id, availability, first_in_school, retake_in_school, retake_self_study, exam_fee, exam_fee_source) values
      ('p-i-bio', 'p-oa-bio', 'p-a', 'Whole subject', 'all_papers', 'subject', 'p-june', 'open', true, true, true, 9850, 'typed'),
      ('p-i-chem', 'p-oa-chem', 'p-a', 'Whole subject', 'all_papers', 'subject', 'p-june', 'open', true, true, true, null, null),
      ('p-i-phys', 'p-oa-phys', 'p-a', 'Whole subject', 'all_papers', 'subject', 'p-june', 'open', true, true, true, null, null),
      ('p-i-b', 'p-ob-bio', 'p-b', 'Whole subject', 'all_papers', 'subject', 'p-june', 'open', true, true, true, 9850, 'typed'),
      ('p-i-geo', 'p-ob-geo', 'p-b', 'Whole subject', 'all_papers', 'subject', 'p-june', 'open', true, true, true, null, null),
      ('p-i-hist', 'p-ob-hist', 'p-b', 'Whole subject', 'all_papers', 'subject', 'p-june', 'open', true, true, true, null, null)`);
    for (const [item, subj] of [['p-i-bio', 'p-bio'], ['p-i-chem', 'p-chem'], ['p-i-phys', 'p-phys'], ['p-i-b', 'p-bio'], ['p-i-geo', 'p-geo'], ['p-i-hist', 'p-hist']]) {
      await db.query(`insert into session_offer_item_fee_key (id, item_id, key_kind, subject_id) values ($1, $2, 'subject', $3)`, [`fk-${item}`, item, subj]);
    }
    await db.query(`insert into board_fee (id, board_series_id, key_kind, subject_id, amount, provisional, confirmed_at) values
      ('p-fee-bio', 'p-june', 'subject', 'p-bio', 9850, false, now() - interval '10 days'),
      ('p-fee-chem', 'p-june', 'subject', 'p-chem', 10850, true, null),
      ('p-fee-geo', 'p-june', 'subject', 'p-geo', 7700, true, null),
      ('p-fee-hist', 'p-june', 'subject', 'p-hist', 6600, false, now() - interval '3 days')`);
    // A: Biology waiting, priced from the confirmed row (its basis says confirmed); Chemistry waiting, provisional.
    await line('p-l-bio', 'p-a', 'p-bio', 'p-i-bio', { id: 'p-fee-bio', amount: 9850, provisional: false }, 'pending_payment', false);
    await line('p-l-chem', 'p-a', 'p-chem', 'p-i-chem', { id: 'p-fee-chem', amount: 10850, provisional: true }, 'pending_payment', true);
    // B: a line priced from the row while it was provisional at 9,000, made payable by the prices-final switch (the row was
    // then confirmed at 9,850: not the old Confirm's condition); a finished line; and a waiting provisional line on a row with
    // no exam fee in this final session (stuck: refused by 0072).
    await line('p-l-switch', 'p-b', 'p-bio', 'p-i-b', { id: 'p-fee-bio', amount: 9000, provisional: true }, 'pending_payment', false);
    await line('p-l-done', 'p-b', 'p-bio', 'p-i-b', { id: 'p-fee-bio', amount: 9850, provisional: false }, 'expired', false, 'p-stu2');
    await line('p-l-stuck', 'p-b', 'p-geo', 'p-i-geo', { id: 'p-fee-geo', amount: 7700, provisional: true }, 'pending_payment', true);
    // The board-deadline reminder kind: the seeded rule (0051) never sent anything; a session's own rule sent one reminder.
    await db.query(`insert into reminder_rule (id, kind, session_id, offsets_days, until, channels, template_id, active) values
      ('p-rule-ed', 'entry_deadline', 'p-a', ARRAY[-14], 'deadline', ARRAY['in_app'], 'tpl-entry-deadline', true)`);
    await db.query(`insert into message (id, audience_id, template_id, channels, notification_type, source, reminder_rule_id, status, sent_at) values
      ('p-msg', 'aud-all', 'tpl-entry-deadline', ARRAY['in_app'], 'STAFF_REMINDER', 'reminder', 'p-rule-ed', 'sent', now())`);
    await db.query(`insert into reminder_sent (id, rule_id, kind, target_kind, target_id, anchor_on, offset_days, message_id, sent_on) values
      ('p-sent', 'p-rule-ed', 'entry_deadline', 'series_entry', 'p-june', current_date + 14, -14, 'p-msg', current_date)`);
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
    await admin?.end();
  });

  const lines = () => db.query(`select id, status, price_at_registration::float as price, course_fee_at_registration::float as course,
    registration_fee_at_registration::float as board, price_provisional as provisional, pricing_basis as basis, due_at from registration order by id`);

  it('0072 refuses a waiting line priced provisional from the grid on a row with no exam fee in a session whose prices are final, naming it; nothing changes', async () => {
    const before = await lines();
    await expect(migrate(tags.slice(71, 73))).rejects.toThrow(/p-l-stuck \(June B, Geography — Whole subject\)/);
    expect(await lines()).toEqual(before);
    expect(await db.query(`select count(*)::int as n from board_fee`)).toEqual([{ n: 4 }]);
    expect(await db.query(`select id from reminder_rule where kind = 'entry_deadline' order by id`)).toEqual([{ id: 'p-rule-ed' }, { id: 'rule-entry-deadline' }]);
  });

  it('once it is dealt with (the row given its exam fee in the subject editor, which re-prices the line — here the line taken away), 0071 and 0072 run: fees from the grid, the grid\'s last word on the payable lines, every line\'s money as it was, the grid and the columns gone', async () => {
    await db.query(`delete from registration where id = 'p-l-stuck'`);
    const before = await lines();
    const confirmedAt = (await db.query<{ at: Date }>(`select confirmed_at as at from board_fee where id = 'p-fee-bio'`))[0]!.at;
    const finalAt = (await db.query<{ at: Date }>(`select prices_final_at as at from registration_session where id = 'p-b'`))[0]!.at;
    await migrate(tags.slice(71, 73));

    // The rows, audited: Chemistry takes its provisional grid row's amount (its session's prices are not final: a price not
    // final, as the session says); History its confirmed one in a final session. Geography, a provisional amount in a session
    // whose prices are final, stays not set (payable otherwise; her check list names it), as does Physics (no grid row).
    expect(await db.query(`select id, exam_fee::float as fee, exam_fee_source as source from session_offer_item order by id`)).toEqual([
      { id: 'p-i-b', fee: 9850, source: 'typed' }, { id: 'p-i-bio', fee: 9850, source: 'typed' }, { id: 'p-i-chem', fee: 10850, source: 'typed' },
      { id: 'p-i-geo', fee: null, source: null }, { id: 'p-i-hist', fee: 6600, source: 'typed' }, { id: 'p-i-phys', fee: null, source: null },
    ]);
    expect(await db.query(`select entity_id as id, new_data->>'gridProvisional' as provisional from audit_log where action = 'OFFER_ITEM_UPDATED' and new_data->>'reason' like 'P1c:%' order by entity_id`))
      .toEqual([{ id: 'p-i-chem', provisional: 'true' }, { id: 'p-i-hist', provisional: 'false' }]);

    // Every line's money, mark and status as it was; the waiting payable v1 lines keep the grid's last word in their basis.
    const after = await lines();
    const strip = (rows: Record<string, unknown>[]) => rows.map(({ basis: _b, ...rest }) => rest);
    expect(strip(after)).toEqual(strip(before));
    const basisOf = (id: string) => after.find((l) => l.id === id)!.basis as Record<string, unknown>;
    const beforeOf = (id: string) => before.find((l) => l.id === id)!.basis as Record<string, unknown>;
    const kept = (id: string) => {
      const { feeConfirmedAt, ...rest } = basisOf(id);
      expect(rest).toEqual(beforeOf(id));
      return new Date(String(feeConfirmedAt)).getTime();
    };
    // Biology's: its fee row's confirmation. The switch's line: the prices-final switch's time (P1b fix 1's rule). A finished
    // (expired) line too — any status (L2: a paid line reversed and re-dated later reads it).
    expect(kept('p-l-bio')).toBe(confirmedAt.getTime());
    expect(kept('p-l-switch')).toBe(finalAt.getTime());
    expect(kept('p-l-done')).toBe(confirmedAt.getTime());
    // A provisional line gets none (it is made payable by the prices-final switch, whose time the rule reads then).
    expect(basisOf('p-l-chem')).toEqual(beforeOf('p-l-chem'));

    // The grid, the keys and the availability columns are gone.
    expect(await db.query(`select table_name from information_schema.tables where table_name in ('board_fee', 'session_offer_item_fee_key')`)).toEqual([]);
    expect(await db.query(`select table_name, column_name from information_schema.columns where column_name = 'availability' and table_name in ('session_offer', 'session_offer_item')`)).toEqual([]);

    // 0071: the seeded rule that never sent anything is deleted (audited); the session's rule that sent one is kept, switched off.
    expect(await db.query(`select id, active from reminder_rule where kind = 'entry_deadline' order by id`)).toEqual([{ id: 'p-rule-ed', active: false }]);
    expect(await db.query(`select entity_id as id, new_data->>'deleted' as deleted from audit_log where action = 'REMINDER_RULE_SET' and entity_id = 'rule-entry-deadline'`))
      .toEqual([{ id: 'rule-entry-deadline', deleted: 'true' }]);
    expect(await db.query(`select id, reminder_rule_id as rule from message where id = 'p-msg'`)).toEqual([{ id: 'p-msg', rule: 'p-rule-ed' }]);
    expect(await db.query(`select active from message_template where key = 'entry_deadline'`)).toEqual([{ active: false }]);
    // The kind is retired: a new rule of it, or switching the kept one on, is refused by the database.
    await expect(db.query(`insert into reminder_rule (id, kind, session_id, offsets_days, until, channels, template_id, active) values
      ('p-rule-new', 'entry_deadline', null, ARRAY[-14], 'deadline', ARRAY['in_app'], 'tpl-entry-deadline', true)`)).rejects.toThrow(/reminder_rule_kind_valid/);
    await expect(db.query(`update reminder_rule set active = true where id = 'p-rule-ed'`)).rejects.toThrow(/reminder_rule_kind_valid/);
  });
});
