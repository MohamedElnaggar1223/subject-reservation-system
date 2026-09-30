import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, one, sql, notified, money, clientFor,
  openWindow, futureWindow, makeTodayASchoolDay, schoolToday, type Client,
} from './helpers';

/**
 * Object-level access (security audit, Phase 1.1).
 *
 * Two families. Family A owns real records of every kind: confirmed and
 * pending registrations, a desk payment and a pending InstaPay payment,
 * receipts, free escrow, a withdrawal, a drop request, remark requests, a
 * preregistration, a link, notifications and a file. Family B's parent and
 * student then try every endpoint that takes one of A's ids or A's student
 * id. Each attempt must be refused (a 4xx) and leave A's records exactly as
 * they were; list endpoints must not return A's rows.
 *
 * Set OBJECT_ACCESS_OUT=/path/file.tsv to write every attempt and its status.
 */

type Res = { status: number; json(): Promise<unknown> };
const attempts: string[] = [];

/** An attempt that must be refused: returns the status, asserts it is a 4xx. */
async function refusedAs(label: string, p: Promise<Res>): Promise<number> {
  const res = await p;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  attempts.push([label, String(res.status), typeof body.error === 'string' ? body.error : ''].join('\t'));
  expect(res.status, `${label} answered ${res.status}: ${JSON.stringify(body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);
  expect(res.status, `${label} answered ${res.status}`).toBeLessThan(500);
  return res.status;
}

describe('object-level access between families', () => {
  let adm: Client, officer: Client, finadmin: Client;
  let parentA: Client, studentA: Client, studentAId: string;
  let parentB: Client, studentB: Client, studentBId: string;
  let phys: string, chem: string, geo: string, hist: string, bio: string, econ: string, maths: string, lit: string;
  let sessionId: string, draftId: string;
  // Family A's records
  let physA: string, chemA: string, geoA: string, deskPaymentA: string, physReceiptA: string;
  let bioA: string, instaPaymentA: string, econA: string, preregA: string;
  let crA: string, remarkStudentA: string, remarkParentA: string, linkA: string, notificationA: string;
  let withdrawalA: string, fileA: string, fileB: string, avatarB: string;
  // Family B's own records, used to test attaching A's file
  let physB: string, bioB: string, instaPaymentB: string, remarkB: string;

  const escrowOf = async (id: string) =>
    money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [id])).balance);
  const statusOf = async (table: string, id: string) =>
    (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;

  afterAll(() => {
    const out = process.env.OBJECT_ACCESS_OUT;
    if (out) writeFileSync(out, ['attempt\tstatus\terror', ...attempts].join('\n') + '\n');
  });

  beforeAll(async () => {
    adm = await admin('oa');
    officer = await staff(adm, 'finance_officer', 'oa');
    finadmin = await staff(adm, 'finance_admin', 'oa');
    const as = { qualificationLevel: 'as_level' as const };
    phys = await subject(adm, 'OA-PHY', 'Physics (AS)', { course: 1200, registration: 300 }, as);
    chem = await subject(adm, 'OA-CHE', 'Chemistry (AS)', { course: 1200, registration: 300 }, as);
    geo = await subject(adm, 'OA-GEO', 'Geography (AS)', { course: 1200, registration: 300 }, as);
    hist = await subject(adm, 'OA-HIS', 'History (AS)', { course: 1200, registration: 300 }, as);
    bio = await subject(adm, 'OA-BIO', 'Biology (AS)', { course: 1200, registration: 300 }, as);
    econ = await subject(adm, 'OA-ECO', 'Economics (AS)', { course: 1200, registration: 300 }, as);
    maths = await subject(adm, 'OA-MAT', 'Mathematics (AS)', { course: 1200, registration: 300 }, as);
    lit = await subject(adm, 'OA-LIT', 'Literature (AS)', { course: 1200, registration: 300 }, as);
    sessionId = await session(adm, 'November (AS, object access)', 'november', 'as_level', { ...openWindow(), activate: true });
    draftId = await session(adm, 'January (AS, object access)', 'january', 'as_level', futureWindow());
    await apiResponse(finadmin.api.v1.remarks.fees.$put({ json: { council: 'cambridge', serviceType: 'review_of_marking', amountPerPaper: 800 } }));

    ({ parent: parentA, student: studentA, studentId: studentAId } = await onboard(officer, 'oa-a', 12));
    ({ parent: parentB, student: studentB, studentId: studentBId } = await onboard(officer, 'oa-b', 12));

    // A: three subjects paid in cash at the desk.
    const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: studentAId, sessionId, subjectIds: [phys, chem, geo], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    const regOf = (s: string) => desk.registrations.find((r) => r.subjectId === s)!.id;
    physA = regOf(phys); chemA = regOf(chem); geoA = regOf(geo);
    deskPaymentA = desk.payment!.id;
    physReceiptA = (await one<{ id: string }>(`select id from receipt where registration_id = $1`, [physA])).id;

    // A: 1500 of free escrow the real way (desk-paid, receipt out, dropped, receipt back).
    const h = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: studentAId, sessionId, subjectIds: [hist], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    const hr = await one<{ id: string }>(`select id from receipt where registration_id = $1`, [h.registrations[0]!.id]);
    await apiResponse(officer.api.v1.receipts[':id'].issue.$post({ param: { id: hr.id } }));
    await apiResponse(parentA.api.v1.registrations[':id'].drop.$post({ param: { id: h.registrations[0]!.id }, json: { reason: 'setup for escrow' } }));
    await apiResponse(officer.api.v1.receipts[':id'].return.$post({ param: { id: hr.id }, json: {} }));
    expect(await escrowOf(studentAId)).toBe(1500);

    // A: a withdrawal of 200 waiting for the desk (escrow now 1300).
    withdrawalA = (await apiResponse(parentA.api.v1.escrow.withdraw.$post({ json: { studentId: studentAId, amount: 200 } }))).id;

    // A: a direct registration with a pending InstaPay payment.
    bioA = (await apiResponse(parentA.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [bio], studentId: studentAId } })))[0]!.id;
    instaPaymentA = (await apiResponse(parentA.api.v1.payments.initiate.$post({
      json: { registrationIds: [bioA], paymentMethod: 'instapay', escrowAmountToApply: 0 },
    }))).id!;

    // A: a student request waiting for the parent, and a preregistration.
    econA = (await apiResponse(studentA.api.v1.registrations.request.$post({ json: { sessionId, subjectIds: [econ] } })))[0]!.id;
    preregA = (await apiResponse(parentA.api.v1.registrations.preregister.$post({ json: { sessionId: draftId, subjectIds: [lit], studentId: studentAId } })))[0]!.id;

    // A: a drop request from the student on a confirmed subject.
    const cr = await apiResponse(studentA.api.v1.registrations[':id']['request-drop'].$post({ param: { id: chemA }, json: { reason: 'too much work' } }));
    crA = cr.id;

    // A: results, a student-requested remark and a parent-requested remark.
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: physA, grade: 'C' }, { registrationId: geoA, grade: 'D' }] } }));
    remarkStudentA = (await apiResponse(studentA.api.v1.remarks.$post({
      json: { registrationId: physA, serviceType: 'review_of_marking', papers: [{ paperCode: '9702/22' }] },
    }))).id;
    remarkParentA = (await apiResponse(parentA.api.v1.remarks.$post({
      json: { registrationId: geoA, serviceType: 'review_of_marking', papers: [{ paperCode: '9696/12' }] },
    }))).id;

    linkA = (await one<{ id: string }>(`select id from parent_student_link where student_id = $1`, [studentAId])).id;
    await notified(parentA.email, 'PAYMENT_CONFIRMED', 2);
    notificationA = (await one<{ id: string }>(
      `select n.id from notification n join "user" u on u.id = n.user_id where u.email = $1 and n.type = 'PAYMENT_CONFIRMED' and n.read_at is null limit 1`,
      [parentA.email]
    )).id;

    // Files cannot be uploaded without R2, so the rows are written directly.
    fileA = randomUUID(); fileB = randomUUID(); avatarB = randomUUID();
    await sql(`insert into file (id, name, mime_type, size, storage_key, file_type, user_id) values ($1, 'a.pdf', 'application/pdf', 10, 'test/a.pdf', 'document', $2)`, [fileA, parentA.id]);
    await sql(`insert into file (id, name, mime_type, size, storage_key, file_type, user_id) values ($1, 'b.pdf', 'application/pdf', 10, 'test/b.pdf', 'document', $2)`, [fileB, parentB.id]);
    await sql(`insert into file (id, name, mime_type, size, storage_key, file_type, user_id) values ($1, 'b.webp', 'image/webp', 10, 'test/b.webp', 'avatar', $2)`, [avatarB, parentB.id]);

    // B: a confirmed, resulted subject with a remark awaiting consent, and a pending InstaPay payment.
    const deskB = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: studentBId, sessionId, subjectIds: [phys], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    physB = deskB.registrations[0]!.id;
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: physB, grade: 'C' }] } }));
    remarkB = (await apiResponse(parentB.api.v1.remarks.$post({
      json: { registrationId: physB, serviceType: 'review_of_marking', papers: [{ paperCode: '9702/42' }] },
    }))).id;
    bioB = (await apiResponse(parentB.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [bio], studentId: studentBId } })))[0]!.id;
    instaPaymentB = (await apiResponse(parentB.api.v1.payments.initiate.$post({
      json: { registrationIds: [bioB], paymentMethod: 'instapay', escrowAmountToApply: 0 },
    }))).id!;
  });

  it('registrations: B cannot read, drop, swap, approve, reject, revert or register for A', async () => {
    await refusedAs('parentB GET registration A', parentB.api.v1.registrations[':id'].$get({ param: { id: physA } }));
    await refusedAs('studentB GET registration A', studentB.api.v1.registrations[':id'].$get({ param: { id: physA } }));
    await refusedAs('parentB GET history A', parentB.api.v1.registrations.history.$get({ query: { studentId: studentAId } } as never));
    await refusedAs('parentB GET available subjects for A', parentB.api.v1.registrations.available.$get({ query: { sessionId, studentId: studentAId } }));
    await refusedAs('parentB drop A', parentB.api.v1.registrations[':id'].drop.$post({ param: { id: physA }, json: { reason: 'not mine' } }));
    await refusedAs('parentB swap A', parentB.api.v1.registrations[':id'].swap.$post({ param: { id: physA }, json: { newSubjectId: maths, reason: 'not mine' } }));
    await refusedAs('studentB request-drop A', studentB.api.v1.registrations[':id']['request-drop'].$post({ param: { id: physA }, json: { reason: 'not mine' } }));
    await refusedAs('studentB request-swap A', studentB.api.v1.registrations[':id']['request-swap'].$post({ param: { id: physA }, json: { newSubjectId: maths, reason: 'not mine' } }));
    await refusedAs('parentB approve A request', parentB.api.v1.registrations.approve.$put({ json: { registrationIds: [econA] } }));
    await refusedAs('parentB reject A request', parentB.api.v1.registrations.reject.$put({ json: { registrationIds: [econA], comments: 'not mine' } }));
    expect(await statusOf('registration', econA)).toBe('pending_approval');
    // Only an approved student request can be reverted: A approves it, then B tries.
    await apiResponse(parentA.api.v1.registrations.approve.$put({ json: { registrationIds: [econA] } }));
    await refusedAs('parentB revert A approval', parentB.api.v1.registrations['revert-approval'].$put({ json: { registrationIds: [econA] } }));
    expect(await statusOf('registration', econA)).toBe('pending_payment');
    await refusedAs('parentB direct-register A', parentB.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [maths], studentId: studentAId } }));
    await refusedAs('parentB preregister A', parentB.api.v1.registrations.preregister.$post({ json: { sessionId: draftId, subjectIds: [maths], studentId: studentAId } }));
    await refusedAs('parentB cancel A prereg', parentB.api.v1.registrations[':id']['cancel-prereg'].$post({ param: { id: preregA } }));

    expect(await statusOf('registration', physA)).toBe('confirmed');
    expect(await statusOf('registration', bioA)).toBe('pending_payment');
    expect(await statusOf('registration', preregA)).toBe('preregistered');
    expect(await sql(`select 1 from registration where student_id = $1 and subject_id = $2`, [studentAId, maths])).toEqual([]);
    expect(await sql(`select 1 from change_request where registration_id = $1 and id <> $2`, [physA, crA])).toEqual([]);

    const pending = await apiResponse(parentB.api.v1.registrations.pending.$get());
    expect(pending.map((r) => r.id)).not.toContain(econA);
  });

  it('payments and receipts: B cannot read, pay, reference or preview A', async () => {
    await refusedAs('parentB GET payment A', parentB.api.v1.payments[':id'].$get({ param: { id: deskPaymentA } }));
    await refusedAs('parentB GET payment receipt PDF A', parentB.api.v1.payments[':id'].receipt.$get({ param: { id: deskPaymentA } }));
    // Payments are the parent's: even A's own student is refused, a check the
    // role matrix cannot see because it runs after the record is looked up.
    await refusedAs('studentA GET own family payment', studentA.api.v1.payments[':id'].$get({ param: { id: deskPaymentA } }));
    await refusedAs('studentA GET own family payment receipt PDF', studentA.api.v1.payments[':id'].receipt.$get({ param: { id: deskPaymentA } }));
    await refusedAs('parentB instapay-reference A', parentB.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: instaPaymentA }, json: { reference: 'FT-NOT-MINE-1' } }));
    await refusedAs('parentB cancel payment A', parentB.api.v1.payments[':id'].cancel.$post({ param: { id: instaPaymentA } }));
    await refusedAs('parentB initiate for A', parentB.api.v1.payments.initiate.$post({ json: { registrationIds: [bioA], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    await refusedAs('parentB checkout-summary A', parentB.api.v1.payments['checkout-summary'].$get({ query: { registrationIds: bioA } }));
    await refusedAs('parentB GET receipt A', parentB.api.v1.receipts[':id'].$get({ param: { id: physReceiptA } }));
    await refusedAs('studentB GET receipt A', studentB.api.v1.receipts[':id'].$get({ param: { id: physReceiptA } }));
    await refusedAs('parentB refund-preview A', parentB.api.v1.receipts['refund-preview'].$get({ query: { registrationId: physA } }));
    await refusedAs('parentB school-fee status A', parentB.api.v1['school-fees'].status.$get({ query: { studentId: studentAId } }));
    await refusedAs('parentB school-fee pay A', parentB.api.v1['school-fees'].pay.$post({ json: { studentId: studentAId, paymentMethod: 'in_school' } }));

    expect(await one(`select status, verification_reference from payment where id = $1`, [instaPaymentA])).toEqual({ status: 'pending', verification_reference: null });
    expect(await sql(`select 1 from payment_registration pr join payment p on p.id = pr.payment_id where pr.registration_id = $1 and p.parent_id = $2`, [bioA, parentB.id])).toEqual([]);

    const mine = await apiResponse(parentB.api.v1.payments.$get({ query: {} }));
    expect(mine.map((p) => p.studentId)).not.toContain(studentAId);
    const filtered = await parentB.api.v1.payments.$get({ query: { studentId: studentAId } });
    if (filtered.status === 200) {
      const rows = (await filtered.json() as { data: { studentId: string }[] }).data;
      expect(rows.map((p) => p.studentId)).not.toContain(studentAId);
    }
  });

  it('escrow: B cannot read, move or withdraw A money', async () => {
    const before = await escrowOf(studentAId);
    await refusedAs('parentB GET escrow A', parentB.api.v1.escrow.$get({ query: { studentId: studentAId } }));
    await refusedAs('parentB GET escrow transactions A', parentB.api.v1.escrow.transactions.$get({ query: { studentId: studentAId } }));
    await refusedAs('parentB transfer A to B', parentB.api.v1.escrow.transfer.$post({ json: { fromStudentId: studentAId, toStudentId: studentBId, amount: 100 } }));
    await refusedAs('parentB withdraw A', parentB.api.v1.escrow.withdraw.$post({ json: { studentId: studentAId, amount: 100 } }));
    expect(await escrowOf(studentAId)).toBe(before);

    const withdrawals = await parentB.api.v1.escrow.withdrawals.$get({ query: { studentId: studentAId } });
    if (withdrawals.status === 200) {
      const rows = (await withdrawals.json() as { data: { id: string }[] }).data;
      expect(rows.map((w) => w.id)).not.toContain(withdrawalA);
    }

    // A student's escrow view is their own whatever id they pass.
    const own = await apiResponse(studentB.api.v1.escrow.$get({ query: { studentId: studentAId } }));
    expect(JSON.stringify(own)).not.toContain(studentAId);
  });

  it('change requests: B cannot read, approve, reject or cancel A', async () => {
    await refusedAs('parentB GET change request A', parentB.api.v1['change-requests'][':id'].$get({ param: { id: crA } }));
    await refusedAs('studentB GET change request A', studentB.api.v1['change-requests'][':id'].$get({ param: { id: crA } }));
    await refusedAs('parentB approve change request A', parentB.api.v1['change-requests'][':id'].approve.$put({ param: { id: crA }, json: {} }));
    await refusedAs('parentB reject change request A', parentB.api.v1['change-requests'][':id'].reject.$put({ param: { id: crA }, json: { comments: 'not mine' } }));
    await refusedAs('studentB cancel change request A', studentB.api.v1['change-requests'][':id'].cancel.$put({ param: { id: crA } }));
    expect(await statusOf('change_request', crA)).toBe('pending_approval');

    const listed = await apiResponse(parentB.api.v1['change-requests'].$get({ query: { studentId: studentAId } }));
    expect(listed.map((c) => c.id)).not.toContain(crA);
  });

  it('remarks: B cannot request, decide, consent, pay or cancel for A', async () => {
    // chemA is confirmed; give it a result so the only thing standing in B's way is ownership.
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: chemA, grade: 'B' }] } }));
    await refusedAs('parentB create remark on A', parentB.api.v1.remarks.$post({ json: { registrationId: chemA, serviceType: 'review_of_marking', papers: [{ paperCode: 'X/1' }] } }));
    await refusedAs('studentB create remark on A', studentB.api.v1.remarks.$post({ json: { registrationId: chemA, serviceType: 'review_of_marking', papers: [{ paperCode: 'X/1' }] } }));
    // Staff pass the role gate but only families may ask for a remark.
    await refusedAs('officer create remark on A', officer.api.v1.remarks.$post({ json: { registrationId: chemA, serviceType: 'review_of_marking', papers: [{ paperCode: 'X/1' }] } }));
    await refusedAs('admin create remark on A', adm.api.v1.remarks.$post({ json: { registrationId: chemA, serviceType: 'review_of_marking', papers: [{ paperCode: 'X/1' }] } }));
    await refusedAs('parentB approve remark A', parentB.api.v1.remarks[':id'].approve.$put({ param: { id: remarkStudentA }, json: {} }));
    await refusedAs('parentB reject remark A', parentB.api.v1.remarks[':id'].reject.$put({ param: { id: remarkStudentA }, json: {} }));
    await refusedAs('parentB cancel remark A', parentB.api.v1.remarks[':id'].cancel.$post({ param: { id: remarkStudentA } }));
    await refusedAs('studentB cancel remark A', studentB.api.v1.remarks[':id'].cancel.$post({ param: { id: remarkStudentA } }));
    await refusedAs('parentB consent remark A', parentB.api.v1.remarks[':id'].consent.$post({ param: { id: remarkParentA }, json: { attest: true } }));
    expect(await statusOf('remark_request', remarkStudentA)).toBe('pending_approval');
    expect(await statusOf('remark_request', remarkParentA)).toBe('pending_consent');
    expect(await sql(`select 1 from remark_request where registration_id = $1`, [chemA])).toEqual([]);

    // Once A has consented, B still cannot pay A's remark.
    await apiResponse(parentA.api.v1.remarks[':id'].consent.$post({ param: { id: remarkParentA }, json: { attest: true } }));
    await refusedAs('parentB pay remark A', parentB.api.v1.remarks[':id'].pay.$post({ param: { id: remarkParentA }, json: { paymentMethod: 'in_school' } }));
    expect(await statusOf('remark_request', remarkParentA)).toBe('pending_payment');

    const listed = await apiResponse(parentB.api.v1.remarks.$get());
    expect(listed.map((r) => r.id)).not.toContain(remarkStudentA);
    expect(listed.map((r) => r.id)).not.toContain(remarkParentA);
  });

  it('links and notifications: B cannot read or answer A link, a pending link grants nothing, B cannot mark A notification', async () => {
    await refusedAs('parentB GET link A', parentB.api.v1.links[':id'].$get({ param: { id: linkA } }));
    await refusedAs('studentB GET link A', studentB.api.v1.links[':id'].$get({ param: { id: linkA } }));
    await refusedAs('studentB answer link A', studentB.api.v1.links[':id'].$put({ param: { id: linkA }, json: { status: 'rejected' } }));
    expect(await statusOf('parent_student_link', linkA)).toBe('approved');

    // B's parent asks to link to A's student: the request exists, but grants nothing until A's student approves.
    const ask = await parentB.api.v1.links.$post({ json: { studentEmail: studentA.email } });
    expect(ask.status).toBeLessThan(300);
    const pendingLink = (await one<{ id: string }>(
      `select id from parent_student_link where parent_id = $1 and student_id = $2`, [parentB.id, studentAId]
    )).id;
    // Only A's student may answer it; B's student approving it would hand A's records to B's parent.
    await refusedAs('studentB approve link addressed to A', studentB.api.v1.links[':id'].$put({ param: { id: pendingLink }, json: { status: 'approved' } }));
    expect(await statusOf('parent_student_link', pendingLink)).toBe('pending');
    await refusedAs('parentB with pending link GET escrow A', parentB.api.v1.escrow.$get({ query: { studentId: studentAId } }));
    await refusedAs('parentB with pending link GET history A', parentB.api.v1.registrations.history.$get({ query: { studentId: studentAId } } as never));

    await refusedAs('parentB mark notification A read', parentB.api.v1.notifications[':id'].read.$put({ param: { id: notificationA } }));
    expect((await one<{ read_at: string | null }>(`select read_at from notification where id = $1`, [notificationA])).read_at).toBeNull();
  });

  it('files: B cannot read, download or delete A file', async () => {
    await refusedAs('parentB GET file A', parentB.api.v1.files[':id'].$get({ param: { id: fileA } }));
    await refusedAs('parentB download file A', parentB.api.v1.files[':id'].download.$get({ param: { id: fileA } }));
    await refusedAs('parentB delete file A', parentB.api.v1.files[':id'].$delete({ param: { id: fileA } }));
    expect(await sql(`select 1 from file where id = $1`, [fileA])).toHaveLength(1);
  });

  it('files: B cannot attach A file to B own InstaPay payment or remark consent', async () => {
    await refusedAs('parentB attach file A as InstaPay screenshot', parentB.api.v1.payments[':id']['instapay-reference'].$post({
      param: { id: instaPaymentB }, json: { reference: 'FT-B-0001', screenshotFileId: fileA },
    }));
    expect(await one(`select verification_file_id from payment where id = $1`, [instaPaymentB])).toEqual({ verification_file_id: null });

    await refusedAs('parentB attach file A as remark consent', parentB.api.v1.remarks[':id'].consent.$post({
      param: { id: remarkB }, json: { attest: true, consentFileId: fileA },
    }));
    expect(await statusOf('remark_request', remarkB)).toBe('pending_consent');

    // Evidence must be a document: B's own avatar is refused, because
    // replacing an avatar deletes the old one.
    await refusedAs('parentB attach own avatar as InstaPay screenshot', parentB.api.v1.payments[':id']['instapay-reference'].$post({
      param: { id: instaPaymentB }, json: { reference: 'FT-B-0003', screenshotFileId: avatarB },
    }));
    expect(await one(`select verification_file_id from payment where id = $1`, [instaPaymentB])).toEqual({ verification_file_id: null });

    // B's own document is accepted in both places.
    await apiResponse(parentB.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: instaPaymentB }, json: { reference: 'FT-B-0002', screenshotFileId: fileB } }));
    expect(await one(`select verification_file_id from payment where id = $1`, [instaPaymentB])).toEqual({ verification_file_id: fileB });
    await apiResponse(parentB.api.v1.remarks[':id'].consent.$post({ param: { id: remarkB }, json: { attest: true, consentFileId: fileB } }));
    expect(await statusOf('remark_request', remarkB)).toBe('pending_payment');

    // Once attached, the file is evidence: its owner cannot delete it (the
    // foreign keys are ON DELETE SET NULL, so deleting would erase the link).
    const del = await parentB.api.v1.files[':id'].$delete({ param: { id: fileB } });
    const delBody = (await del.json()) as { error?: string };
    attempts.push(['parentB delete own file attached as evidence', String(del.status), delBody.error ?? ''].join('\t'));
    expect(del.status).toBe(400);
    expect(delBody.error).toBe('This file is attached to a payment or a remark request and cannot be deleted');
    expect(await sql(`select 1 from file where id = $1`, [fileB])).toHaveLength(1);
    // The database refuses it too, so no race between attach and delete can
    // erase the evidence (foreign keys are ON DELETE RESTRICT since 0027).
    await expect(sql(`delete from file where id = $1`, [fileB])).rejects.toThrow();
    expect(await sql(`select 1 from file where id = $1`, [fileB])).toHaveLength(1);
  });

  // ─── F0a ─────────────────────────────────────────────────────────────────

  it("F0a uploads: B cannot read A's family files nor upload for A's student", async () => {
    const pdf = new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'note.pdf', { type: 'application/pdf' });
    const note = (await apiResponse(parentA.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'supporting_document', studentId: studentAId } }))).id;
    const shot = (await apiResponse(parentA.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'payment_evidence', studentId: studentAId } }))).id;
    for (const id of [note, shot]) {
      await refusedAs('parentB read A family file', parentB.api.v1.files[':id'].content.$get({ param: { id }, query: {} }));
      await refusedAs('studentB read A family file', studentB.api.v1.files[':id'].content.$get({ param: { id }, query: {} }));
      await refusedAs('parentB file A metadata', parentB.api.v1.files[':id'].$get({ param: { id } }));
      await refusedAs('parentB file A download', parentB.api.v1.files[':id'].download.$get({ param: { id } }));
    }
    // A's own student reads the family's supporting document.
    expect((await studentA.api.v1.files[':id'].content.$get({ param: { id: note }, query: {} })).status).toBe(200);
    const before = Number((await one<{ n: string }>(`select count(*) as n from file where student_id = $1`, [studentAId])).n);
    await refusedAs('parentB upload for student A', parentB.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'supporting_document', studentId: studentAId } }));
    await refusedAs('studentB upload excuse for student A', studentB.api.v1.files.upload.$post({ form: { file: pdf, purpose: 'excuse_note', studentId: studentAId } }));
    expect(Number((await one<{ n: string }>(`select count(*) as n from file where student_id = $1`, [studentAId])).n)).toBe(before);
  });

  it("F0a eligibility: B cannot ask whether A's student may register", async () => {
    await refusedAs('parentB eligibility of student A', parentB.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }));
    await refusedAs('studentB eligibility of student A', studentB.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }));
    // A's own family may.
    expect((await apiResponse(parentA.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }))).allowed).toBe(true);
    expect((await apiResponse(studentA.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }))).allowed).toBe(true);
  });

  it("F0a another class and the gate: a teacher reaches only their own teaching; the gate only the school day", async () => {
    const coordinator = await staff(adm, 'coordinator', 'oa-class');
    const [teacherA, teacherB, gate] = await Promise.all([staff(adm, 'teacher', 'oa-a'), staff(adm, 'teacher', 'oa-b'), staff(adm, 'gate', 'oa')]);
    // A year of its own, far ahead, so no later suite's academic year is taken.
    const far = new Date().getFullYear() + 8;
    const year = await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: far, startsOn: `${far}-09-06`, endsOn: `${far + 1}-06-25` } }));
    const teacherAId = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [teacherA.id])).id;
    const sectionA = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: year.id, grade: 11, name: 'OA-11A', homeroomTeacherId: teacherAId } }))).id;

    // Another class: teacher B reads neither teacher A's section nor any student's record.
    await refusedAs('teacherB reads teacher A section', teacherB.api.v1.academic.sections[':id'].$get({ param: { id: sectionA } }));
    await refusedAs('teacherB lists sections', teacherB.api.v1.academic.sections.$get({ query: {} }));
    await refusedAs('teacherB adds to teacher A section', teacherB.api.v1.academic.sections[':id'].members.$post({ param: { id: sectionA }, json: { studentIds: [studentAId] } }));
    await refusedAs('teacherB reads student A record', teacherB.api.v1.students[':id'].$get({ param: { id: studentAId } }));
    await refusedAs('teacherB lists students', teacherB.api.v1.students.$get({ query: {} }));
    await refusedAs('teacherB reads student A at the desk', teacherB.api.v1.users[':id'].summary.$get({ param: { id: studentAId } }));
    await refusedAs('teacherB reads A family file', teacherB.api.v1.files[':id'].content.$get({ param: { id: fileA }, query: {} }));
    const mine = await apiResponse(teacherB.api.v1.teaching.me.$get());
    expect(mine?.teacher.id).not.toBe(teacherAId);
    expect(mine?.homeroomSections.some((s) => s.id === sectionA)).toBe(false);

    // The gate: the school day, and nothing about a family.
    expect((await gate.api.v1.academic.calendar.day.$get({ query: {} })).status).toBe(200);
    await refusedAs('gate reads student A record', gate.api.v1.students[':id'].$get({ param: { id: studentAId } }));
    await refusedAs('gate lists students', gate.api.v1.students.$get({ query: {} }));
    await refusedAs('gate reads student A at the desk', gate.api.v1.users[':id'].summary.$get({ param: { id: studentAId } }));
    await refusedAs('gate searches people', gate.api.v1.users.search.$get({ query: { search: 'oa-a' } }));
    await refusedAs('gate reads registrations', gate.api.v1.registrations.$get({ query: { studentId: studentAId } }));
    await refusedAs('gate reads payments', gate.api.v1.payments.$get({ query: {} }));
    await refusedAs('gate reads section A', gate.api.v1.academic.sections[':id'].$get({ param: { id: sectionA } }));
    await refusedAs('gate asks student A eligibility', gate.api.v1.registrations.eligibility.$get({ query: { studentId: studentAId, sessionId } }));
    await refusedAs('gate reads A family file', gate.api.v1.files[':id'].content.$get({ param: { id: fileA }, query: {} }));
  });

  // ─── F0b ─────────────────────────────────────────────────────────────────

  it("F0b course enrolment: B cannot read or change A's student's enrolment; a teacher reads only their own class", async () => {
    const coordinator = await staff(adm, 'coordinator', 'oa-enr');
    const [teacherA, teacherB] = [await staff(adm, 'teacher', 'oa-enr-a'), await staff(adm, 'teacher', 'oa-enr-b')];
    const teacherAId = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [teacherA.id])).id;
    // Last academic year (A's student was in grade 11): later suites create this year's.
    const Y = academicYearStartOf() - 1;
    const years = await apiResponse(coordinator.api.v1.academic.years.$get());
    const yearId = years.find((y) => y.startYear === Y)?.id
      ?? (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    const e = await apiResponse(coordinator.api.v1.enrolments.$post({
      json: { academicYearId: yearId, studentId: studentAId, subjectId: phys, teacherId: teacherAId, mode: 'in_school' },
    }));
    const snapshot = () => sql(`select * from course_enrolment where student_id = $1`, [studentAId]);
    const before = await snapshot();

    // Another family: answered as not found, nothing learned, nothing changed.
    expect(await refusedAs('parentB reads A enrolment', parentB.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: { academicYearId: yearId } }))).toBe(404);
    expect(await refusedAs('studentB reads A enrolment', studentB.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: { academicYearId: yearId } }))).toBe(404);
    await refusedAs('parentB lists enrolments', parentB.api.v1.enrolments.$get({ query: { academicYearId: yearId, studentId: studentAId } }));
    await refusedAs('parentB checks A enrolment', parentB.api.v1.enrolments.check.$get({ query: { academicYearId: yearId, studentId: studentAId } }));
    await refusedAs('parentB ends A enrolment', parentB.api.v1.enrolments[':id'].end.$post({ param: { id: e.id }, json: { reason: 'not theirs to end' } }));
    await refusedAs('studentB changes A enrolment', studentB.api.v1.enrolments[':id'].$put({ param: { id: e.id }, json: { mode: 'self_study' } }));
    // A's own family reads it.
    expect((await apiResponse(parentA.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: { academicYearId: yearId } }))).enrolments.map((x) => x.subjectId)).toEqual([phys]);
    expect((await apiResponse(studentA.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: { academicYearId: yearId } }))).enrolments.map((x) => x.subjectId)).toEqual([phys]);

    // Another class: teacher B does not read teacher A's Physics class, nor enrol anyone.
    await refusedAs('teacherB reads teacher A class', teacherB.api.v1.enrolments.class.$get({ query: { subjectId: phys, academicYearId: yearId } }));
    await refusedAs('teacherB reads A enrolment', teacherB.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: studentAId }, query: {} }));
    await refusedAs('teacherB enrols student A', teacherB.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: studentAId, subjectId: chem, mode: 'in_school' } }));
    expect((await apiResponse(teacherA.api.v1.enrolments.class.$get({ query: { subjectId: phys, academicYearId: yearId } }))).students.map((x) => x.studentId)).toEqual([studentAId]);
    expect(await snapshot()).toEqual(before);
  });

  // ─── F1 ──────────────────────────────────────────────────────────────────

  it("F1 timetables: another family's child, another class's lesson, a cover teacher outside the covered lesson and date, the gate, and a wrong or revoked feed link", async () => {
    // A year of its own far ahead, two families of its own (grade 11 then), two teachers each with a group, a cover teacher.
    const Y = academicYearStartOf() + 24;
    const coordinator = await staff(adm, 'coordinator', 'oa-tt');
    const gate = await staff(adm, 'gate', 'oa-tt');
    const [ta, tb, tc] = [await staff(adm, 'teacher', 'oa-tt-a'), await staff(adm, 'teacher', 'oa-tt-b'), await staff(adm, 'teacher', 'oa-tt-c')];
    const tid = async (c: Client) => (await one<{ id: string }>(`select id from teacher where user_id = $1`, [c.id])).id;
    const [taId, tbId, tcId] = [await tid(ta), await tid(tb), await tid(tc)];
    const year = (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    const term = (await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: year, name: 'Term 1', startsOn: `${Y}-09-06`, endsOn: `${Y}-12-20` } }))).id;
    const bells = await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: year, name: 'Regular', isDefault: true } }));
    await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({ param: { id: bells.id }, json: { periods: [
      { weekday: null, label: 'P1', kind: 'lesson', startsAt: '08:00', endsAt: '08:45' }, { weekday: null, label: 'P2', kind: 'lesson', startsAt: '08:45', endsAt: '09:30' },
    ] } }));
    const fa = await onboard(officer, 'oa-tt-a', 11);
    const fb = await onboard(officer, 'oa-tt-b', 11);
    for (const f of [fa, fb]) await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: f.studentId }, json: { cohortYear: Y - 1, reason: 'F1 object access year' } }));
    const physTT = await subject(adm, 'OA-TT-PHY', 'Physics (timetable)', { course: 1000, registration: 300 });
    const ga = await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: year, name: 'OA Physics A', subjectId: physTT, teacherId: taId, weeklyPeriods: 1, doublePeriods: 0, studentIds: [fa.studentId], startsOn: `${Y}-09-06` } }));
    const gb = await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: year, name: 'OA Physics B', subjectId: physTT, teacherId: tbId, weeklyPeriods: 1, doublePeriods: 0, studentIds: [fb.studentId], startsOn: `${Y}-09-06` } }));
    await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: year, name: 'OA Physics C', subjectId: physTT, teacherId: tcId, weeklyPeriods: 0, doublePeriods: 0 } }));
    const tt = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId: term, name: 'OA' } }))).id;
    const editor = await apiResponse(coordinator.api.v1.timetables[':id'].$get({ param: { id: tt } }));
    const la = editor.engine.lessons.find((l) => l.groupId === ga.id)!.id;
    const lb = editor.engine.lessons.find((l) => l.groupId === gb.id)!.id;
    for (const [lessonId, period] of [[la, 1], [lb, 2]] as const) {
      await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: tt, lessonId }, json: { weekday: 0, period, from: { weekday: null, period: null } } }));
    }
    await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: tt }, json: { effectiveFrom: `${Y}-09-06` } }));
    const sunday = (() => { const d = new Date(`${Y}-10-04T12:00:00Z`); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    const nextSunday = new Date(new Date(`${sunday}T12:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: taId, startsOn: sunday, endsOn: sunday, reason: 'sick' } }));
    await apiResponse(coordinator.api.v1.cover.assignments.$post({ json: { lessonId: la, date: sunday, coverTeacherId: tcId } }));
    const covers = () => sql(`select id, status, cover_teacher_id from cover_assignment where lesson_id in ($1, $2) order by id`, [la, lb]);
    const before = await covers();

    // Another family: nothing about the other child, as "not found".
    expect(await refusedAs('parentB reads A timetable (day)', fb.parent.api.v1.schedule.day.$get({ query: { studentId: fa.studentId, date: sunday } }))).toBe(404);
    expect(await refusedAs('parentB reads A timetable (week)', fb.parent.api.v1.schedule.week.$get({ query: { studentId: fa.studentId, date: sunday } }))).toBe(404);
    expect(await refusedAs('studentB reads A timetable', fb.student.api.v1.schedule.week.$get({ query: { studentId: fa.studentId, date: sunday } }))).toBe(404);
    await refusedAs('parentB reads a teacher timetable', fb.parent.api.v1.schedule.week.$get({ query: { teacherId: taId, date: sunday } }));
    await refusedAs('parentB reads a lesson class', fb.parent.api.v1.schedule.lesson.$get({ query: { lessonId: la, date: sunday } }));
    // Their own family reads it.
    expect((await apiResponse(fa.parent.api.v1.schedule.day.$get({ query: { studentId: fa.studentId, date: sunday } }))).lessons.map((l) => l.lessonId)).toEqual([la]);

    // Another class: teacher B reads neither teacher A's timetable nor A's lesson, nor arranges its cover.
    expect(await refusedAs('teacherB reads teacher A timetable', tb.api.v1.schedule.week.$get({ query: { teacherId: taId, date: sunday } }))).toBe(404);
    expect(await refusedAs('teacherB reads A lesson class', tb.api.v1.schedule.lesson.$get({ query: { lessonId: la, date: nextSunday } }))).toBe(404);
    await refusedAs('teacherB reads A student timetable', tb.api.v1.schedule.day.$get({ query: { studentId: fa.studentId, date: sunday } }));
    await refusedAs('teacherB arranges cover', tb.api.v1.cover.assignments.$post({ json: { lessonId: lb, date: sunday, coverTeacherId: tbId } }));
    await refusedAs('teacherB edits the timetable', tb.api.v1.timetables[':id'].$get({ param: { id: tt } }));
    // The cover teacher: the covered lesson on its date, and nothing else.
    expect((await apiResponse(tc.api.v1.schedule.lesson.$get({ query: { lessonId: la, date: sunday } }))).students.map((s) => s.id)).toEqual([fa.studentId]);
    expect(await refusedAs('cover teacher reads the lesson another date', tc.api.v1.schedule.lesson.$get({ query: { lessonId: la, date: nextSunday } }))).toBe(404);
    expect(await refusedAs('cover teacher reads another lesson that date', tc.api.v1.schedule.lesson.$get({ query: { lessonId: lb, date: sunday } }))).toBe(404);
    expect(await refusedAs('cover teacher reads teacher A timetable', tc.api.v1.schedule.week.$get({ query: { teacherId: taId, date: sunday } }))).toBe(404);
    // A's own teacher reads their lesson on any date it takes place.
    expect((await apiResponse(ta.api.v1.schedule.lesson.$get({ query: { lessonId: la, date: nextSunday } }))).access).toBe('teacher');

    // The gate: nothing of the timetable (its own is empty: not linked to a teacher record).
    await refusedAs('gate reads A timetable', gate.api.v1.schedule.day.$get({ query: { studentId: fa.studentId, date: sunday } }));
    await refusedAs('gate reads a lesson class', gate.api.v1.schedule.lesson.$get({ query: { lessonId: la, date: sunday } }));
    await refusedAs('gate lists timetables', gate.api.v1.timetables.$get({ query: {} }));
    await refusedAs('gate reads groups', gate.api.v1.scheduling.groups.$get({ query: { academicYearId: year } }));
    await refusedAs('gate reads absences', gate.api.v1.cover.absences.$get({ query: {} }));
    await refusedAs('gate own timetable (not a teacher)', gate.api.v1.schedule.me.day.$get({ query: { date: sunday } }));

    // The calendar feed: a wrong token and a revoked one get nothing.
    const link = await apiResponse(fa.parent.api.v1.schedule.feed.$post());
    const token = link.path.split('/').pop()!;
    const anon = await clientFor();
    const good = await anon.v1.ical[':token'].$get({ param: { token } });
    expect(good.status).toBe(200);
    expect(await good.text()).toContain('SUMMARY:Student oa-tt-a: OA Physics A');
    const wrong = await anon.v1.ical[':token'].$get({ param: { token: token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA') } });
    expect(wrong.status).toBe(404);
    expect(await wrong.text()).not.toContain('VEVENT');
    attempts.push(['wrong calendar feed token', String(wrong.status), ''].join('\t'));
    await apiResponse(fa.parent.api.v1.schedule.feed.$delete());
    const revoked = await anon.v1.ical[':token'].$get({ param: { token } });
    expect(revoked.status).toBe(404);
    expect(await revoked.text()).not.toContain('VEVENT');
    attempts.push(['revoked calendar feed token', String(revoked.status), ''].join('\t'));
    // B's own link shows B's child only.
    const bLink = await apiResponse(fb.parent.api.v1.schedule.feed.$post());
    const bFeed = await (await anon.v1.ical[':token'].$get({ param: { token: bLink.path.split('/').pop()! } })).text();
    expect(bFeed).toContain('OA Physics B');
    expect(bFeed).not.toContain('OA Physics A');
    expect(await covers()).toEqual(before);
  });

  // ─── F2 ──────────────────────────────────────────────────────────────────

  it("F2 campus leave: another family's leave, pass and collectors; another class; the gate reaching only today's list and only what check-out needs", async () => {
    const coordinator = await staff(adm, 'coordinator', 'oa-lv');
    const gate = await staff(adm, 'gate', 'oa-lv');
    const teacher = await staff(adm, 'teacher', 'oa-lv');
    await makeTodayASchoolDay(coordinator);
    const far = `${academicYearStartOf() + 28}-10-06`;
    const png = () => new File([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))], 'p.png', { type: 'image/png' });
    const pdf = () => new File([new TextEncoder().encode('%PDF-1.4\n%oa\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')], 'order.pdf', { type: 'application/pdf' });
    const upload = (who: Client, purpose: 'collector_photo' | 'custody_photo' | 'custody_document', file: File, studentId: string) =>
      apiResponse(who.api.v1.files.upload.$post({ form: { file, purpose, studentId } }));
    const content = (who: Client, id: string) => who.api.v1.files[':id'].content.$get({ param: { id }, query: {} });

    // A's records: a collector with a photo, a request for a later day, today's approved leave, a custody restriction.
    const photoA = await upload(parentA, 'collector_photo', png(), studentAId);
    const collectorA = await apiResponse(parentA.api.v1.leave.collectors.$post({ json: { name: 'Oa Grandfather', relation: 'Grandparent', phone: '01000001000', idNumber: '26001011234567', photoFileId: photoA.id, studentIds: [studentAId] } }));
    await apiResponse(coordinator.api.v1.leave.collectors[':id'].approve.$post({ param: { id: collectorA.id } }));
    const farLeave = (await apiResponse(parentA.api.v1.leave.requests.$post({ json: { studentId: studentAId, date: far, leaveTime: '09:00', returning: false, reasonCategory: 'medical', collector: { kind: 'parent', parentId: parentA.id } } }))).leaves[0]!.id;
    await apiResponse(coordinator.api.v1.leave.requests[':id'].approve.$post({ param: { id: farLeave }, json: {} }));
    const farPass = (await apiResponse(parentA.api.v1.leave.requests[':id'].pass.$get({ param: { id: farLeave } }))).token!;
    const todayLeave = (await apiResponse(coordinator.api.v1.leave.requests.$post({ json: { studentId: studentAId, date: schoolToday(), leaveTime: '08:00', returning: false, reasonCategory: 'medical', collector: { kind: 'collector', collectorId: collectorA.id }, approveNow: true } }))).leaves[0]!.id;
    const custodyPhoto = await upload(coordinator, 'custody_photo', png(), studentAId);
    const custodyDoc = await upload(coordinator, 'custody_document', pdf(), studentAId);
    await apiResponse(coordinator.api.v1.leave.restrictions.$post({ json: { studentId: studentAId, personName: 'Oa Restricted', note: 'Court order', photoFileId: custodyPhoto.id, documentFileId: custodyDoc.id } }));
    // B's collector (B has no leave today).
    const photoB = await upload(parentB, 'collector_photo', png(), studentBId);
    await apiResponse(parentB.api.v1.leave.collectors.$post({ json: { name: 'Oa Aunt', relation: 'Aunt', phone: '01000001001', idNumber: '26101011234567', photoFileId: photoB.id, studentIds: [studentBId] } }));
    const snapshot = async () => [
      await sql(`select id, status, pass_version, cancelled_at, checked_out_at from leave_request where student_id = $1 order by id`, [studentAId]),
      await sql(`select c.id, c.status from leave_collector c join leave_collector_student s on s.collector_id = c.id where s.student_id = $1 order by c.id`, [studentAId]),
      await sql(`select id, ended_at from leave_custody_restriction where student_id = $1`, [studentAId]),
    ];
    const before = await snapshot();

    // Another family: nothing of A's, as "not found"; nothing changed.
    for (const [who, label] of [[parentB, 'parentB'], [studentB, 'studentB']] as const) {
      expect(await refusedAs(`${label} reads A leave`, who.api.v1.leave.requests[':id'].$get({ param: { id: farLeave } }))).toBe(404);
      expect(await refusedAs(`${label} reads A pass`, who.api.v1.leave.requests[':id'].pass.$get({ param: { id: todayLeave } }))).toBe(404);
      expect(await refusedAs(`${label} lists A leave`, who.api.v1.leave.requests.$get({ query: { studentId: studentAId } }))).toBe(404);
      expect(await refusedAs(`${label} lists A collectors`, who.api.v1.leave.collectors.$get({ query: { studentId: studentAId } }))).toBe(404);
      expect(await refusedAs(`${label} reads A collector photo`, content(who, photoA.id))).toBe(404);
      expect(await refusedAs(`${label} reads A custody photo`, content(who, custodyPhoto.id))).toBe(404);
      await refusedAs(`${label} reads A leave record`, who.api.v1.leave.students[':studentId'].$get({ param: { studentId: studentAId } }));
      await refusedAs(`${label} reads A restrictions`, who.api.v1.leave.restrictions.$get({ query: { studentId: studentAId } }));
      expect((await apiResponse(who.api.v1.leave.family.$get())).children.map((c) => c.id)).not.toContain(studentAId);
      expect((await apiResponse(who.api.v1.leave.requests.$get({ query: {} }))).map((l) => l.student.id)).not.toContain(studentAId);
    }
    expect(await refusedAs('parentB replaces A pass', parentB.api.v1.leave.requests[':id'].pass.$post({ param: { id: todayLeave } }))).toBe(404);
    expect(await refusedAs('parentB cancels A leave', parentB.api.v1.leave.requests[':id'].cancel.$post({ param: { id: farLeave }, json: {} }))).toBe(404);
    expect(await refusedAs('parentB requests for A', parentB.api.v1.leave.requests.$post({ json: { studentId: studentAId, date: far, leaveTime: '10:00', returning: false, reasonCategory: 'medical', collector: { kind: 'parent', parentId: parentB.id } } }))).toBe(404);
    expect(await refusedAs('parentB adds a collector for A', parentB.api.v1.leave.collectors.$post({ json: { name: 'Oa Stranger', relation: 'Uncle', phone: '01000001002', idNumber: '26201011234567', studentIds: [studentAId] } }))).toBe(404);
    expect(await refusedAs('parentB withdraws A collector', parentB.api.v1.leave.collectors[':id'].withdraw.$post({ param: { id: collectorA.id }, json: {} }))).toBe(404);
    await refusedAs('parentB approves A leave', parentB.api.v1.leave.requests[':id'].approve.$post({ param: { id: farLeave }, json: {} }));
    await refusedAs('studentB cancels A leave', studentB.api.v1.leave.requests[':id'].cancel.$post({ param: { id: farLeave }, json: {} }));

    // Another class: a teacher sees no family's leave, only the students leaving their own lessons (none here).
    await refusedAs('teacher reads A leave', teacher.api.v1.leave.requests[':id'].$get({ param: { id: farLeave } }));
    await refusedAs('teacher lists leave', teacher.api.v1.leave.requests.$get({ query: { studentId: studentAId } }));
    await refusedAs('teacher reads the gate list', teacher.api.v1.leave.gate.today.$get());
    await refusedAs('teacher lists A collectors', teacher.api.v1.leave.collectors.$get({ query: { studentId: studentAId } }));
    expect(await refusedAs('teacher reads A collector photo', content(teacher, photoA.id))).toBe(404);
    expect((await apiResponse(teacher.api.v1.leave.teaching.$get({ query: {} }))).lessons).toEqual([]);

    // The gate: today's list only, and only what check-out needs.
    const list = await apiResponse(gate.api.v1.leave.gate.today.$get());
    expect(list.leaves.map((l) => l.id)).toContain(todayLeave);
    expect(list.leaves.map((l) => l.id)).not.toContain(farLeave);
    expect(JSON.stringify(list)).not.toContain('Court order');
    expect(await refusedAs('gate reads a leave', gate.api.v1.leave.requests[':id'].$get({ param: { id: farLeave } }))).toBe(403);
    expect(await refusedAs('gate lists leave', gate.api.v1.leave.requests.$get({ query: { date: far } }))).toBe(403);
    expect(await refusedAs('gate checks out another day', gate.api.v1.leave.gate[':id']['check-out'].$post({ param: { id: farLeave }, json: { collectedBy: { kind: 'parent', parentId: parentA.id }, idChecked: true, via: 'lookup' } }))).toBe(404);
    expect(await refusedAs('gate records a return another day', gate.api.v1.leave.gate[':id'].return.$post({ param: { id: farLeave }, json: {} }))).toBe(404);
    expect(await refusedAs("gate scans another day's pass", gate.api.v1.leave.gate.scan.$post({ json: { token: farPass } }))).toBe(409);
    expect(await refusedAs('gate lists collectors', gate.api.v1.leave.collectors.$get({ query: { studentId: studentAId } }))).toBe(403);
    expect(await refusedAs('gate reads restrictions', gate.api.v1.leave.restrictions.$get({ query: { studentId: studentAId } }))).toBe(403);
    expect(await refusedAs('gate reads A leave record', gate.api.v1.leave.students[':studentId'].$get({ param: { studentId: studentAId } }))).toBe(403);
    expect(await refusedAs('gate reads reports', gate.api.v1.leave.reports.$get({ query: { from: far, to: far } }))).toBe(403);
    expect(await refusedAs('gate reads the queue', gate.api.v1.leave.queue.$get())).toBe(403);
    expect(await refusedAs('gate approves', gate.api.v1.leave.requests[':id'].approve.$post({ param: { id: farLeave }, json: {} }))).toBe(403);
    // Photos only for a student on today's list; never the custody document.
    expect((await content(gate, photoA.id)).status).toBe(200);
    expect((await content(gate, custodyPhoto.id)).status).toBe(200);
    expect(await refusedAs('gate reads the custody document', content(gate, custodyDoc.id))).toBe(404);
    expect(await refusedAs('gate reads a photo of a student not leaving today', content(gate, photoB.id))).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('F0a exceptions: each type names who may grant it — a coordinator is refused a fee waiver, a finance admin the grade-10 exception', async () => {
    const coordinator = await staff(adm, 'coordinator', 'oa');
    const exceptionsOf = async () => Number((await one<{ n: string }>(`select count(*) as n from exception where student_id = $1`, [studentBId])).n);
    const before = await exceptionsOf();
    const waiver = coordinator.api.v1.exceptions.$post({ json: { type: 'fee_waiver', studentId: studentBId, reason: 'not the coordinator\'s to grant' } });
    expect(await refusedAs('coordinator grants a fee waiver', waiver)).toBe(403);
    const g10 = finadmin.api.v1.exceptions.$post({ json: { type: 'grade10_other_series', studentId: studentBId, sessionId, reason: 'not the finance admin\'s to grant' } });
    expect(await refusedAs('finance admin grants the grade-10 exception', g10)).toBe(403);
    expect(await exceptionsOf()).toBe(before);
    // Nor may either revoke the other's type; each sees only its own types.
    const w = await apiResponse(finadmin.api.v1.exceptions.$post({ json: { type: 'fee_waiver', studentId: studentBId, reason: 'hardship case' } }));
    expect(await refusedAs('coordinator revokes a fee waiver', coordinator.api.v1.exceptions[':id'].revoke.$post({ param: { id: w.id } }))).toBe(403);
    expect(await statusOf('exception', w.id)).toBe('active');
    expect((await apiResponse(coordinator.api.v1.exceptions.$get({ query: {} }))).some((e) => e.id === w.id)).toBe(false);
    await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: w.id } }));
  });
});
