import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import { admin, staff, onboard, subject, session, refused, one, sql, money, openWindow, audited, type Client } from './helpers';

/**
 * 08r — the exceptions registry (RESERVATIONS_REWORK.md §3.7, §4.7; docs/features/RESERVATIONS_MONEY.md §3).
 *
 * Every policy an exception can lift is one entry of the registry: who may grant it, the value it
 * takes, the scopes it accepts and what none means, one-shot or not. Grants are checked against it;
 * every hook reads exceptions through it (the student's own, or the family's: every linked child);
 * the eight V3 types were moved onto it by migration 0046 — the same mapping its trigger applies to
 * a V3-shaped row — and the two whose meaning changed wait under "Check these".
 *
 * Course fee 1,000 and board fee 500 (a line of 1,500).
 */

const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY);
const day = (d: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(inDays(d));

describe('08r: the exceptions registry', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client;
  let june: string;
  const subj: Record<string, string> = {};
  type Family = Awaited<ReturnType<typeof onboard>>;

  const priceOf = async (id: string) => money((await one<{ p: string }>(`select price_at_registration as p from registration where id = $1`, [id])).p);
  const deskUnpaid = async (studentId: string, subjectIds: string[]) =>
    (await apiResponse(officer.api.v1.registrations.desk.$post({ json: { studentId, sessionId: june, subjectIds } }))).registrations.map((r) => r.id);
  const deskPaid = async (studentId: string, subjectIds: string[]) =>
    (await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId, sessionId: june, subjectIds, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }))).registrations.map((r) => r.id);

  beforeAll(async () => {
    adm = await admin('xr');
    officer = await staff(adm, 'finance_officer', 'xr');
    finadmin = await staff(adm, 'finance_admin', 'xr');
    coordinator = await staff(adm, 'coordinator', 'xr');
    for (let i = 1; i <= 12; i++) {
      subj[`S${i}`] = await subject(adm, `XR-${i}`, `Subject ${i} (AS, registry)`, { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    }
    june = await session(adm, 'June (AS, registry)', 'june', 'as_level', { ...openWindow(), activate: true });
  });

  it('GET /policies: every policy with its sentence, value, scopes and grantors; what each caller may grant now', async () => {
    const forFinance = await apiResponse(finadmin.api.v1.policies.$get());
    const byKey = Object.fromEntries(forFinance.policies.map((p) => [p.key, p]));
    expect(Object.keys(byKey).sort()).toEqual([
      'deadline.boardEntry', 'deadline.payment', 'deadline.window', 'eligibility.grade10OtherSeries', 'gate.availability', 'gate.exclusiveItems',
      'gate.grade10Core', 'gate.priorSeries', 'gate.requiredItems', 'gate.sameEntryOnce', 'gate.schoolFee', 'gate.selfStudyFirstEntry',
      'plan.instalments', 'price.custom', 'price.discountFixed', 'price.discountPercent', 'pricing.onePaperCoursePercent',
      'pricing.retakeTaughtCoursePercent', 'pricing.selfStudyBoardPercent', 'pricing.selfStudyCoursePercent', 'refund.courseStart', 'refund.percent',
    ]);
    expect(byKey['price.discountPercent']).toMatchObject({ group: 'price', valueType: 'percent', min: 0, max: 100, grantable: true, oneShot: false, nullScope: 'every line reserved from now on' });
    expect(byKey['gate.selfStudyFirstEntry']).toMatchObject({ oneShot: true, grantable: true });
    expect(byKey['eligibility.grade10OtherSeries']).toMatchObject({ grantable: false, whyNot: 'not_your_role' });
    expect(byKey['pricing.selfStudyCoursePercent']).toMatchObject({ grantable: false, whyNot: 'not_applied_yet' });
    expect(byKey['refund.courseStart']).toMatchObject({ nullScope: null, scopes: ['offer', 'line'] });
    const forAdmin = Object.fromEntries((await apiResponse(adm.api.v1.policies.$get())).policies.map((p) => [p.key, p]));
    expect(forAdmin['deadline.boardEntry']).toMatchObject({ grantable: false, whyNot: 'off_by_setting' });
    const forCoordinator = Object.fromEntries((await apiResponse(coordinator.api.v1.policies.$get())).policies.map((p) => [p.key, p]));
    expect(forCoordinator['gate.availability']!.grantable).toBe(true);
    expect(forCoordinator['price.custom']!.grantable).toBe(false);
  });

  it('a grant is checked against the registry: its grantors, its value, the scopes it accepts, a scope where one is required; a pending policy refused; late entries only while their setting is on', async () => {
    const f = await onboard(officer, 'xr-checks', 12);
    const grant = (who: Client, json: Parameters<typeof finadmin.api.v1.exceptions.$post>[0]['json']) => refused(who.api.v1.exceptions.$post({ json }));
    expect((await grant(coordinator, { policyKey: 'price.discountPercent', studentId: f.studentId, value: 10, reason: 'not the coordinator\'s' })).status).toBe(403);
    expect((await grant(finadmin, { policyKey: 'price.discountPercent', studentId: f.studentId, value: 150, reason: 'too much' })).error).toContain('0–100');
    expect((await grant(finadmin, { policyKey: 'gate.schoolFee', studentId: f.studentId, value: 5, reason: 'no value here' })).error).toContain('takes no value');
    expect((await grant(finadmin, { policyKey: 'deadline.window', studentId: f.studentId, scope: { subjectId: subj.S1! }, value: day(10), reason: 'a subject cannot narrow it' })).error).toContain('cannot be narrowed by subject');
    expect((await grant(finadmin, { policyKey: 'refund.courseStart', studentId: f.studentId, value: day(-3), reason: 'no scope' })).error).toContain('choose what it is for');
    expect((await grant(finadmin, { policyKey: 'pricing.selfStudyCoursePercent', studentId: f.studentId, value: 30, reason: 'pending' })).status).toBe(409);
    expect((await grant(finadmin, { policyKey: 'plan.instalments', familyId: f.parent.id, value: [{ dueAt: inDays(3), amount: 100 }], scope: {}, reason: 'family plan' })).status).toBe(400);
    const series = (await one<{ s: string }>(`select distinct i.board_series_id as s from session_offer_item i where i.session_id = $1`, [june])).s;
    const late = { policyKey: 'deadline.boardEntry' as const, studentId: f.studentId, scope: { boardSeriesId: series }, value: day(5), reason: 'late entry (Q-20)' };
    expect((await grant(adm, late)).error).toContain('hard stop');
    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'exceptions.boardEntryDeadline' }, json: { value: true, reason: 'trying a late entry' } }));
    try {
      expect((await grant(finadmin, late)).status).toBe(403);
      const ok = await apiResponse(adm.api.v1.exceptions.$post({ json: late }));
      expect(ok).toMatchObject({ policyKey: 'deadline.boardEntry', boardSeriesId: series });
      await apiResponse(adm.api.v1.exceptions[':id'].revoke.$post({ param: { id: ok.id } }));
    } finally {
      await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'exceptions.boardEntryDeadline' }, json: { value: false, reason: 'back to the hard stop' } }));
    }
    // Who it is for: a student, or a family (a parent account) — never both, never another role.
    expect((await grant(finadmin, { policyKey: 'gate.schoolFee', studentId: f.studentId, familyId: f.parent.id, reason: 'both' })).status).toBe(400);
    expect((await grant(finadmin, { policyKey: 'gate.schoolFee', familyId: f.studentId, reason: 'a student is not a family' })).error).toContain('parent account');
  });

  it('the same exception twice is refused, naming the one that is active; another scope or value is a grant of its own', async () => {
    const f = await onboard(officer, 'xr-twice', 12);
    const waiver = { policyKey: 'gate.schoolFee' as const, studentId: f.studentId, scope: { academicYear: '2026-2027' }, reason: 'scholarship' };
    await apiResponse(finadmin.api.v1.exceptions.$post({ json: waiver }));
    const again = await refused(finadmin.api.v1.exceptions.$post({ json: { ...waiver, reason: 'asked twice' } }));
    expect(again.status).toBe(409);
    expect(again.error).toContain('already active');
    await apiResponse(finadmin.api.v1.exceptions.$post({ json: { ...waiver, scope: { academicYear: '2027-2028' }, reason: 'the next year too' } }));
    const discount = { policyKey: 'price.discountPercent' as const, studentId: f.studentId, scope: { sessionId: june }, value: 10, reason: 'siblings' };
    await apiResponse(finadmin.api.v1.exceptions.$post({ json: discount }));
    expect((await refused(finadmin.api.v1.exceptions.$post({ json: discount }))).status).toBe(409);
    await apiResponse(finadmin.api.v1.exceptions.$post({ json: { ...discount, value: 5, reason: 'a second, smaller one' } }));
  });

  it("a family's exception covers every linked child, and no one else", async () => {
    const f = await onboard(officer, 'xr-family', 12);
    const sibling = await apiResponse(officer.api.v1.links['desk-onboard'].$post({
      json: { parent: { email: f.parent.email }, student: { email: 'student.xr-family-sib@test.local', name: 'Student xr-family-sib', password: 'TestPass1', grade: 12 } },
    }));
    const stranger = await onboard(officer, 'xr-stranger', 12);
    const ex = await apiResponse(finadmin.api.v1.exceptions.$post({
      json: { policyKey: 'price.discountPercent', familyId: f.parent.id, scope: { sessionId: june }, value: 10, reason: 'two children at the school' },
    }));
    expect(ex).toMatchObject({ familyId: f.parent.id, studentId: null, policyKey: 'price.discountPercent', valueNumber: 10 });
    const [mine] = await deskUnpaid(f.studentId, [subj.S1!]);
    const [theirs] = await deskUnpaid(sibling.student.id, [subj.S1!]);
    const [other] = await deskUnpaid(stranger.studentId, [subj.S1!]);
    expect([await priceOf(mine!), await priceOf(theirs!), await priceOf(other!)]).toEqual([1350, 1350, 1500]);
    expect((await apiResponse(finadmin.api.v1.exceptions.$get({ query: { familyId: f.parent.id } }))).map((e) => e.id)).toEqual([ex.id]);
  });

  it('a one-shot gate lets one reservation through and is used by it; the next is refused', async () => {
    const f = await onboard(officer, 'xr-oneshot', 12);
    const selfStudy = (subjectId: string) => f.parent.api.v1.registrations.direct.$post({
      json: { sessionId: june, subjectIds: [subjectId], studentId: f.studentId, subjectOptions: { [subjectId]: { takeOutsideSchool: true } } },
    });
    expect((await refused(selfStudy(subj.S2!))).error).toContain('only be taken outside school');
    const gate = await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'gate.selfStudyFirstEntry', studentId: f.studentId, reason: 'studies abroad this term' } }));
    const [line] = await apiResponse(selfStudy(subj.S2!));
    // Self-study: 50% of the course fee, the board fee in full (A-16).
    expect(await priceOf(line!.id)).toBe(1000);
    const used = await one<{ status: string; used: { registrationIds: string[] } }>(`select status, used_for as used from exception where id = $1`, [gate.id]);
    expect(used).toEqual({ status: 'used', used: { registrationIds: [line!.id] } });
    await audited([gate.id], ['EXCEPTION_USED']);
    expect((await refused(selfStudy(subj.S3!))).error).toContain('only be taken outside school');
    // A used gate cannot be revoked (what it let through stands).
    expect((await refused(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: gate.id } }))).status).toBe(404);
  });

  it('a price exception on one unpaid line re-prices it (its basis records it), and back when it is revoked; on a line with a payment it is refused', async () => {
    const f = await onboard(officer, 'xr-line', 12);
    const [unpaid] = await deskUnpaid(f.studentId, [subj.S4!]);
    const [paid] = await deskPaid(f.studentId, [subj.S5!]);
    const ex = await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'price.discountFixed', studentId: f.studentId, scope: { registrationId: unpaid! }, value: 200, reason: 'agreed at the desk' } }));
    expect(ex.repriced).toEqual({ from: 1500, to: 1300 });
    expect(await one(`select price_at_registration::float as p, course_fee_at_registration::float as c, registration_fee_at_registration::float as b, pricing_basis->'exceptionIds' as ids from registration where id = $1`, [unpaid!]))
      .toEqual({ p: 1300, c: 800, b: 500, ids: [ex.id] });
    await audited([unpaid!], ['LINE_REPRICED']);
    expect((await refused(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'price.discountFixed', studentId: f.studentId, scope: { registrationId: paid! }, value: 200, reason: 'too late' } }))).status).toBe(409);
    // Revoked (granted in error): the unpaid line is priced without it again.
    const back = await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: ex.id } }));
    expect(back.repriced).toEqual({ from: 1300, to: 1500 });
    expect(await one(`select price_at_registration::float as p, pricing_basis->'exceptionIds' as ids from registration where id = $1`, [unpaid!])).toEqual({ p: 1500, ids: [] });
    await audited([unpaid!], ['LINE_REPRICED', 'LINE_REPRICED']);
  });

  it('a price exception on one charge prices it again at once, and back when it is revoked; a charge with a payment keeps its amount', async () => {
    const f = await onboard(officer, 'xr-charge', 12);
    const c = await apiResponse(finadmin.api.v1.charges.$post({ json: { studentId: f.studentId, kind: 'custom', amount: 250, reason: 'a replacement ID card' } }));
    const ex = await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'price.discountFixed', studentId: f.studentId, scope: { chargeId: c.id }, value: 50, reason: 'the first card was faulty' } }));
    expect(ex.repriced).toEqual({ from: 250, to: 200 });
    const amountOf = async () => money((await one<{ a: string }>(`select amount as a from charge where id = $1`, [c.id])).a);
    expect(await amountOf()).toBe(200);
    await audited([c.id], ['CHARGE_CREATED', 'CHARGE_REPRICED']);
    expect((await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: ex.id } }))).repriced).toEqual({ from: 200, to: 250 });
    expect(await amountOf()).toBe(250);
    // Once a payment is open for it, its amount stays: a grant is refused.
    await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [c.id], paymentMethod: 'in_school' } }));
    expect((await refused(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'price.discountFixed', studentId: f.studentId, scope: { chargeId: c.id }, value: 50, reason: 'too late' } }))).status).toBe(409);
  });

  it('deadline.payment moves one line\'s due date, and back when it is revoked', async () => {
    const f = await onboard(officer, 'xr-due', 12);
    const [line] = await deskUnpaid(f.studentId, [subj.S6!]);
    const dueOf = async () => new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [line!])).d);
    const before = await dueOf();
    const ex = await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'deadline.payment', studentId: f.studentId, scope: { registrationId: line! }, value: day(12), reason: 'pays after the salary' } }));
    expect(ex.dueDatesMoved).toBe(1);
    const moved = await dueOf();
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(moved)).toBe(day(12));
    await audited([line!], ['LINE_DUE_MOVED']);
    await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: ex.id } }));
    expect((await dueOf()).getTime()).toBe(before.getTime());
  });

  it("the eight V3 types, as the migration moves them onto the registry (a V3-shaped row is filled the same way), and V3's request shape mapped onto its key", async () => {
    const f = await onboard(officer, 'xr-legacy', 12);
    const insert = async (type: string, extra: { value?: number; validUntil?: Date; subjectId?: string; sessionId?: string } = {}) =>
      (await one<{ id: string }>(
        `insert into exception (id, type, student_id, session_id, subject_id, value, reason, valid_until, status, granted_by)
         values (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'as V3 left it', $6, 'active', $7) returning id`,
        [type, f.studentId, extra.sessionId ?? null, extra.subjectId ?? null, extra.value ?? null, extra.validUntil ?? null, finadmin.id])).id;
    const read = async (id: string) => one<{ policy_key: string; value_number: string | null; value_date: Date | null; check: boolean }>(
      `select policy_key, value_number, value_date, check_reason is not null as check from exception where id = $1`, [id]);
    const until = inDays(20);
    const rows = {
      discount_percent: await insert('discount_percent', { value: 20 }),
      discount_fixed: await insert('discount_fixed', { value: 100, subjectId: subj.S7! }),
      custom_price: await insert('custom_price', { value: 1200, sessionId: june, subjectId: subj.S8! }),
      fee_waiver: await insert('fee_waiver'),
      deadline_extension: await insert('deadline_extension', { validUntil: until, sessionId: june }),
      late_registration: await insert('late_registration', { validUntil: until }),
      custom_refund_percent: await insert('custom_refund_percent', { value: 90, sessionId: june }),
      grade10_other_series: await insert('grade10_other_series'),
    };
    const got = Object.fromEntries(await Promise.all(Object.entries(rows).map(async ([t, id]) => {
      const r = await read(id);
      return [t, [r.policy_key, r.value_number === null ? null : money(r.value_number), r.value_date ? new Date(r.value_date).getTime() === until.getTime() : null, r.check]];
    })));
    expect(got).toEqual({
      discount_percent: ['price.discountPercent', 20, null, false],
      discount_fixed: ['price.discountFixed', 100, null, false],
      custom_price: ['price.custom', 1200, null, false],
      fee_waiver: ['gate.schoolFee', null, null, false],
      deadline_extension: ['deadline.window', null, true, false],
      late_registration: ['deadline.window', null, true, false],
      custom_refund_percent: ['refund.percent', 90, null, false],
      grade10_other_series: ['eligibility.grade10OtherSeries', null, null, false],
    });
    // The two meanings that change are listed: a subject-scoped deadline and a subject-scoped refund percent.
    const ext = await insert('deadline_extension', { validUntil: until, subjectId: subj.S9! });
    const ref = await insert('custom_refund_percent', { value: 30, subjectId: subj.S9! });
    expect([(await read(ext)).check, (await read(ref)).check]).toEqual([true, true]);
    // V3's request shape still grants, mapped the same way.
    const v3 = await apiResponse(finadmin.api.v1.exceptions.$post({ json: { type: 'discount_percent', studentId: f.studentId, sessionId: june, value: 15, reason: 'V3 shape' } }));
    expect(v3).toMatchObject({ type: 'discount_percent', policyKey: 'price.discountPercent', valueNumber: 15, sessionId: june });
    for (const id of [...Object.values(rows), ext, ref, v3.id]) await sql(`update exception set status = 'revoked', revoked_at = now(), revoked_by = $2 where id = $1`, [id, finadmin.id]);
  });

  it('Check these: a migrated subject-scoped refund percent applies to nothing until a finance admin confirms it; then to that subject\'s lines, on the course fee', async () => {
    const f = await onboard(officer, 'xr-check', 12);
    const [line] = await deskPaid(f.studentId, [subj.S10!]);
    const migrated = (await one<{ id: string }>(
      `insert into exception (id, type, student_id, subject_id, value, reason, status, granted_by)
       values (gen_random_uuid()::text, 'custom_refund_percent', $1, $2, 30, 'V3: medical case, scoped to one subject', 'active', $3) returning id`,
      [f.studentId, subj.S10!, finadmin.id])).id;
    const listed = await apiResponse(finadmin.api.v1.exceptions['check-these'].$get());
    expect(listed.find((e) => e.id === migrated)?.why).toContain('never applied');
    expect((await apiResponse(coordinator.api.v1.exceptions['check-these'].$get())).some((e) => e.id === migrated)).toBe(false);
    const preview = () => apiResponse(f.parent.api.v1.receipts['refund-preview'].$get({ query: { registrationId: line! } }));
    // Week 1: 100% of the course fee and the board fee — the migrated 30% is not read yet.
    expect(await preview()).toMatchObject({ percentage: 100, amount: 1500 });
    expect((await refused(coordinator.api.v1.exceptions[':id'].confirm.$post({ param: { id: migrated }, json: {} }))).status).toBe(403);
    await apiResponse(finadmin.api.v1.exceptions[':id'].confirm.$post({ param: { id: migrated }, json: { note: 'confirmed with the family' } }));
    await audited([migrated], ['EXCEPTION_CONFIRMED']);
    expect(await preview()).toMatchObject({ percentage: 30, amount: 800 });
    expect((await apiResponse(finadmin.api.v1.exceptions['check-these'].$get())).some((e) => e.id === migrated)).toBe(false);
  });

  it('Check these: a price exception on an old unit row, once an item of another subject enters that unit', async () => {
    const f = await onboard(officer, 'xr-unit', 12);
    // The catalogue's shape the rework meets (§3.2): a unit registered as its own row ("P1"), then a
    // parent subject whose item enters the same unit.
    const unit = (await one<{ id: string }>(
      `insert into exam_unit (id, board_code, code, title, unit_level, kind) values (gen_random_uuid()::text, 'pearson_edexcel', $1, 'Unit 1 (registry)', 'as', 'unit') returning id`,
      [`XRU${Date.now() % 100000}`])).id;
    await sql(`insert into subject_unit (subject_id, unit_id) values ($1, $2)`, [subj.S11!, unit]);
    const ex = await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'price.discountPercent', studentId: f.studentId, scope: { subjectId: subj.S11! }, value: 25, reason: 'on the unit row' } }));
    expect((await apiResponse(finadmin.api.v1.exceptions['check-these'].$get())).some((e) => e.id === ex.id)).toBe(false);
    const item = (await one<{ id: string }>(`select i.id from session_offer_item i join session_offer o on o.id = i.offer_id where o.session_id = $1 and o.subject_id = $2`, [june, subj.S12!])).id;
    await sql(`insert into session_offer_item_unit (item_id, unit_id) values ($1, $2)`, [item, unit]);
    const listed = (await apiResponse(finadmin.api.v1.exceptions['check-these'].$get())).find((e) => e.id === ex.id);
    expect(listed?.why).toContain('re-scope it');
    await apiResponse(finadmin.api.v1.exceptions[':id'].confirm.$post({ param: { id: ex.id }, json: { note: 'keep it on the old row' } }));
    expect((await apiResponse(finadmin.api.v1.exceptions['check-these'].$get())).some((e) => e.id === ex.id)).toBe(false);
    await sql(`delete from session_offer_item_unit where item_id = $1 and unit_id = $2`, [item, unit]);
  });
});
